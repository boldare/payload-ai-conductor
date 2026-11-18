import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { Payload, TypedUser } from 'payload'

import config from '@payload-config'
import { APICallError } from 'ai'
import { getPayload } from 'payload'
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { buildAgentTools } from '../src/agent/tools.js'
import { createChatEndpointHandler } from '../src/agent/chatEndpoint.js'
import { devUser } from './helpers/credentials.js'

let payload: Payload
let user: TypedUser

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'users', where: { email: { equals: devUser.email } } })
  user = docs[0] as TypedUser
})

describe('buildAgentTools', () => {
  test('list_collections only reports allow-listed collections', async () => {
    const tools = await buildAgentTools(payload, { collections: ['pages'] }, { user })
    const result = await tools.list_collections.execute?.({}, { context: undefined, messages: [], toolCallId: 't1' })
    expect(result).toEqual({ collections: [{ blocksFields: ['layout'], collection: 'pages' }] })
  })

  test('propose_layout refuses a collection outside the allow-list', async () => {
    const tools = await buildAgentTools(payload, { collections: ['pages'] }, { user })
    const result = await tools.propose_layout.execute?.(
      { collection: 'media', data: {} },
      { context: undefined, messages: [], toolCallId: 't2' },
    )
    expect(result).toEqual({ error: 'Collection "media" is not available.' })
  })

  test('propose_layout surfaces validation issues from the real tool layer', async () => {
    const tools = await buildAgentTools(payload, { collections: ['pages'] }, { user })
    const result = await tools.propose_layout.execute?.(
      { collection: 'pages', data: { layout: [{ blockType: 'hero' }] } },
      { context: undefined, messages: [], toolCallId: 't3' },
    )
    expect(result).toMatchObject({ valid: false })
  })

  test('apply_proposal writes a real document end to end', async () => {
    const tools = await buildAgentTools(payload, { collections: ['pages'] }, { user })
    const result = await tools.apply_proposal.execute?.(
      {
        collection: 'pages',
        data: { title: 'From Agent Tools', slug: 'from-agent-tools', layout: [{ blockType: 'hero', heading: 'Hi' }] },
      },
      { context: undefined, messages: [], toolCallId: 't4' },
    )
    expect(result).toMatchObject({ success: true })
  })
})

describe('chat endpoint', () => {
  test('rejects unauthenticated requests', async () => {
    const handler = createChatEndpointHandler({ collections: ['pages'] })
    const req = new Request('http://localhost:3000/api/plugin/ai-conductor/chat', {
      body: JSON.stringify({ messages: [] }),
      method: 'POST',
    }) as unknown as Parameters<ReturnType<typeof createChatEndpointHandler>>[0]
    req.payload = payload
    req.user = null

    const res = await handler(req)
    expect(res.status).toBe(401)
  })

  test('streams a plain-text response back through the real pipeline with a mock model', async () => {
    const streamParts: LanguageModelV4StreamPart[] = [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: '1' },
      { type: 'text-delta', delta: 'Hello from the mock model!', id: '1' },
      { type: 'text-end', id: '1' },
      {
        type: 'finish',
        finishReason: { raw: undefined, unified: 'stop' },
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
          outputTokens: { reasoning: 0, text: 5, total: 5 },
        },
      },
    ]

    const mockModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream(streamParts),
      }),
    })

    const handler = createChatEndpointHandler(
      { collections: ['pages'], getModelConfig: () => ({ apiKey: 'test', model: 'test', provider: 'openai' }) },
      { buildLanguageModel: () => mockModel },
    )

    const req = new Request('http://localhost:3000/api/plugin/ai-conductor/chat', {
      body: JSON.stringify({
        messages: [{ id: '1', parts: [{ text: 'Say hello', type: 'text' }], role: 'user' }],
      }),
      method: 'POST',
    }) as unknown as Parameters<ReturnType<typeof createChatEndpointHandler>>[0]
    req.payload = payload
    req.user = user
    req.locale = undefined

    const res = await handler(req)
    expect(res.status).toBe(200)

    const text = await res.text()
    expect(text).toContain('Hello from the mock model!')
  })

  const chatRequest = (body: unknown) => {
    const req = new Request('http://localhost:3000/api/plugin/ai-conductor/chat', {
      body: JSON.stringify(body),
      method: 'POST',
    }) as unknown as Parameters<ReturnType<typeof createChatEndpointHandler>>[0]
    req.payload = payload
    req.user = user
    req.locale = undefined
    return req
  }
  const hello = [{ id: '1', parts: [{ text: 'Hi', type: 'text' }], role: 'user' }]
  test('no configured model answers with a structured, explainable error instead of a generic one', async () => {
    vi.stubEnv('AI_CONDUCTOR_PROVIDER', '')
    vi.stubEnv('AI_CONDUCTOR_API_KEY', '')
    vi.stubEnv('AI_CONDUCTOR_MODEL', '')
    try {
      const res = await createChatEndpointHandler({ collections: ['pages'] })(chatRequest({ messages: hello }))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'model_not_configured' })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test('a provider auth failure mid-stream reaches the client as invalid_api_key', async () => {
    const mockModel = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({
          data: { error: { message: 'invalid x-api-key', type: 'authentication_error' } },
          message: 'Unauthorized',
          requestBodyValues: {},
          statusCode: 401,
          url: 'https://api.anthropic.com/v1/messages',
        })
      },
    })
    const handler = createChatEndpointHandler(
      { collections: ['pages'], getModelConfig: () => ({ apiKey: 'bad', model: 'm', provider: 'anthropic' }) },
      { buildLanguageModel: () => mockModel },
    )

    const text = await (await handler(chatRequest({ messages: hello }))).text()
    const errorChunk = text
      .split('\n')
      .filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice(6)))
      .find((chunk) => chunk.type === 'error')
    expect(JSON.parse(errorChunk.errorText)).toEqual({ code: 'invalid_api_key', message: 'invalid x-api-key' })
  })
})
