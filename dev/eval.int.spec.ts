import type { Payload, TypedUser } from 'payload'

import type { UIMessage, UIMessageChunk } from 'ai'

import config from '@payload-config'
import { generateObject, generateText, hasToolCall, readUIMessageStream, stepCountIs } from 'ai'
import { convertArrayToReadableStream } from 'ai/test'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'

import { createChatEndpointHandler, SYSTEM_PROMPT } from '../src/agent/chatEndpoint.js'
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

// Opt-in (it makes several real, billed calls per model): AI_CONDUCTOR_EVAL_55=1 plus an Anthropic
// key in AI_CONDUCTOR_API_KEY. Runs the full chat endpoint — propose, user says "apply", approval,
// resumed request — on each 5.5 model. That exercises the two things specific to these models:
// `thinking.display: "updates"` is accepted, and thinking blocks replayed from earlier turns pass the
// API's history check (they come back from the client as UI messages, not from server memory).
const anthropicKey = process.env.AI_CONDUCTOR_PROVIDER === 'anthropic' ? process.env.AI_CONDUCTOR_API_KEY : undefined
const runFiveFiveEval = Boolean(process.env.AI_CONDUCTOR_EVAL_55 && anthropicKey)

let payload: Payload
let user: TypedUser

afterAll(async () => {
  if (hasApiKey || runFiveFiveEval) {
    await payload.destroy()
  }
})

beforeAll(async () => {
  if (!hasApiKey && !runFiveFiveEval) {
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

type ChatRequest = Parameters<ReturnType<typeof createChatEndpointHandler>>[0]

/** POST to the real chat endpoint and fold the SSE stream into one message, failing on error chunks. */
const sendChat = async (
  handler: ReturnType<typeof createChatEndpointHandler>,
  messages: UIMessage[],
  seed?: UIMessage,
): Promise<UIMessage> => {
  const req = new Request('http://localhost:3000/api/plugin/ai-conductor/chat', {
    body: JSON.stringify({ id: `eval-${Date.now()}`, messages }),
    method: 'POST',
  }) as unknown as ChatRequest
  req.payload = payload
  req.user = user
  req.locale = undefined

  const res = await handler(req)
  const chunks = (await res.text())
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice('data: '.length)) as UIMessageChunk)
  const error = chunks.find((chunk) => chunk.type === 'error')
  if (error) {
    throw new Error(`stream error: ${error.errorText}`)
  }
  let last: UIMessage | undefined
  for await (const message of readUIMessageStream({ message: seed, stream: convertArrayToReadableStream(chunks) })) {
    last = message
  }
  if (!last) {
    throw new Error('stream produced no message')
  }
  return last
}

describe.skipIf(!runFiveFiveEval).each(['claude-sonnet-5-5', 'claude-opus-5-5'])('Claude 5.5 chat flow: %s', (model) => {
  test(
    'propose → "apply" → approve → resumed write, with thinking blocks replayed across turns',
    async () => {
      const slug = `eval-${model}-${Date.now()}`
      const handler = createChatEndpointHandler({
        collections: ['pages'],
        getModelConfig: () => ({ apiKey: anthropicKey!, model, provider: 'anthropic' }),
      })

      const ask: UIMessage = {
        id: 'u1',
        parts: [{ type: 'text', text: `Create a page titled "Eval ${model}" with slug "${slug}": a hero and a 3-item feature grid.` }],
        role: 'user',
      }
      const proposed = await sendChat(handler, [ask])
      const proposeCall = proposed.parts.find(
        (part) => part.type === 'tool-propose_layout' || part.type === 'tool-revise_proposal',
      ) as { output?: { valid?: boolean } } | undefined
      expect(proposeCall?.output?.valid, 'model should validate a proposal first').toBe(true)

      const apply: UIMessage = { id: 'u2', parts: [{ type: 'text', text: 'Looks good — apply it.' }], role: 'user' }
      const requested = await sendChat(handler, [ask, proposed, apply])
      const approvalPart = requested.parts.find((part) => part.type === 'tool-apply_proposal')
      expect(approvalPart && 'state' in approvalPart ? approvalPart.state : undefined).toBe('approval-requested')

      const approved: UIMessage = {
        ...requested,
        parts: requested.parts.map((part) =>
          part.type === 'tool-apply_proposal'
            ? ({ ...part, approval: { ...part.approval, approved: true }, state: 'approval-responded' } as UIMessage['parts'][number])
            : part,
        ),
      }
      await sendChat(handler, [ask, proposed, apply, approved], approved)

      const { totalDocs } = await payload.count({ collection: 'pages', where: { slug: { equals: slug } } })
      expect(totalDocs).toBe(1)
    },
    240_000,
  )
})
