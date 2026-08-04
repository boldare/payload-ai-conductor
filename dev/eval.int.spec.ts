import type { Payload, TypedUser } from 'payload'

import config from '@payload-config'
import { generateObject, generateText, hasToolCall, stepCountIs } from 'ai'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'

import { SYSTEM_PROMPT } from '../src/agent/chatEndpoint.js'
import { buildLanguageModel, resolveModelConfigFromEnv } from '../src/agent/provider.js'
import { buildAgentTools } from '../src/agent/tools.js'
import { devUser } from './helpers/credentials.js'

// Requires a real provider key (AI_CONDUCTOR_PROVIDER/AI_CONDUCTOR_API_KEY/AI_CONDUCTOR_MODEL) — skips otherwise,
// so the rest of the suite stays green without one.
const hasApiKey = Boolean(
  process.env.AI_CONDUCTOR_PROVIDER && process.env.AI_CONDUCTOR_API_KEY && process.env.AI_CONDUCTOR_MODEL,
)

const GOLDEN_PROMPTS = [
  {
    name: 'landing page with hero, feature grid, and cta',
    prompt:
      'Build a landing page for a new product called Conductor. It needs a hero section introducing the product, ' +
      'a 3-item feature grid highlighting benefits, and a call-to-action at the bottom.',
    rubric:
      'The proposed layout includes a hero block, a grid block with roughly 3 feature items, and a cta block, ' +
      'in a sensible top-to-bottom order for a landing page.',
  },
  {
    name: 'about page with hero and rich text',
    prompt: 'Create an About page with a hero introducing the company and a paragraph of rich text describing our mission.',
    rubric: 'The proposed layout includes a hero block and a richText block with mission/about-us style content.',
  },
  {
    name: 'adding a testimonial',
    prompt:
      'Add a customer testimonial from Jamie, a product manager, saying the tool saved their team hours every week.',
    rubric:
      'The proposed layout includes a testimonial block whose quote and attribution are consistent with the request ' +
      '(Jamie, a product manager, time saved).',
  },
]

let payload: Payload
let user: TypedUser

afterAll(async () => {
  if (hasApiKey) {
    await payload.destroy()
  }
})

beforeAll(async () => {
  if (!hasApiKey) {
    return
  }
  payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'users', where: { email: { equals: devUser.email } } })
  user = docs[0] as TypedUser
})

describe.skipIf(!hasApiKey)('golden prompts', () => {
  for (const golden of GOLDEN_PROMPTS) {
    test(
      golden.name,
      async () => {
        const model = buildLanguageModel(resolveModelConfigFromEnv())
        const tools = await buildAgentTools(payload, { collections: ['pages'] }, { user })

        const result = await generateText({
          model,
          prompt: golden.prompt,
          stopWhen: [stepCountIs(8), hasToolCall('propose_layout')],
          system: SYSTEM_PROMPT,
          tools,
        })

        const proposeLayoutCall = result.toolResults.find((call) => call.toolName === 'propose_layout')
        expect(proposeLayoutCall, 'model should have called propose_layout').toBeDefined()
        expect((proposeLayoutCall?.output as { valid?: boolean } | undefined)?.valid).toBe(true)

        const judge = await generateObject({
          model,
          prompt: [
            `User request: ${golden.prompt}`,
            `Rubric: ${golden.rubric}`,
            `Proposed layout: ${JSON.stringify(proposeLayoutCall?.input)}`,
            'Does the proposed layout satisfy the rubric? Be strict but fair.',
          ].join('\n\n'),
          schema: z.object({ pass: z.boolean(), reasoning: z.string() }),
        })

        expect(judge.object.pass, judge.object.reasoning).toBe(true)
      },
      60_000,
    )
  }
})
