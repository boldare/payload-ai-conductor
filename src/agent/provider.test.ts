import { generateText } from 'ai'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { buildLanguageModel, resolveModelConfigFromEnv, supportsProgressUpdates } from './provider.js'

const ENV_KEYS = ['AI_CONDUCTOR_PROVIDER', 'AI_CONDUCTOR_API_KEY', 'AI_CONDUCTOR_MODEL'] as const

let originalEnv: Record<string, string | undefined>

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
})

describe('resolveModelConfigFromEnv', () => {
  test('reads provider/apiKey/model from the environment', () => {
    process.env.AI_CONDUCTOR_PROVIDER = 'anthropic'
    process.env.AI_CONDUCTOR_API_KEY = 'test-key'
    process.env.AI_CONDUCTOR_MODEL = 'claude-sonnet-5'

    expect(resolveModelConfigFromEnv()).toEqual({
      apiKey: 'test-key',
      model: 'claude-sonnet-5',
      provider: 'anthropic',
    })
  })

  test('throws a clear error when unset', () => {
    delete process.env.AI_CONDUCTOR_PROVIDER
    delete process.env.AI_CONDUCTOR_API_KEY
    delete process.env.AI_CONDUCTOR_MODEL

    expect(() => resolveModelConfigFromEnv()).toThrow(/no model configured/)
  })

  test('throws for an unsupported provider name', () => {
    process.env.AI_CONDUCTOR_PROVIDER = 'made-up-provider'
    process.env.AI_CONDUCTOR_API_KEY = 'test-key'
    process.env.AI_CONDUCTOR_MODEL = 'test-model'

    expect(() => resolveModelConfigFromEnv()).toThrow(/no model configured/)
  })
})

describe('buildLanguageModel', () => {
  test('constructs an Anthropic model without making a network call', () => {
    const model = buildLanguageModel({ apiKey: 'test-key', model: 'claude-sonnet-5', provider: 'anthropic' })
    expect(typeof model).not.toBe('string')
    expect((model as { modelId: string }).modelId).toBe('claude-sonnet-5')
  })

  test('constructs an OpenAI model without making a network call', () => {
    const model = buildLanguageModel({ apiKey: 'test-key', model: 'gpt-4o', provider: 'openai' })
    expect(typeof model).not.toBe('string')
    expect((model as { modelId: string }).modelId).toBe('gpt-4o')
  })
})

describe('Claude progress updates (display: "updates")', () => {
  const captureAnthropicRequest = async (modelId: string) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        id: 'msg_1',
        type: 'message',
        content: [{ type: 'text', text: 'ok' }],
        model: modelId,
        role: 'assistant',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    )
    try {
      await generateText({ model: buildLanguageModel({ apiKey: 'k', model: modelId, provider: 'anthropic' }), prompt: 'hi' })
      const [, init] = fetchSpy.mock.calls[0]
      const headers = new Headers(init?.headers)
      return { beta: headers.get('anthropic-beta') ?? '', body: JSON.parse(init?.body as string) }
    } finally {
      fetchSpy.mockRestore()
    }
  }

  test.each(['claude-sonnet-5-5', 'claude-opus-5-5'])('%s asks for progress updates with the beta header', async (modelId) => {
    const { beta, body } = await captureAnthropicRequest(modelId)
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'updates' })
    expect(beta).toContain('thinking-display-updates-2026-08-18')
  })

  test('older models are left on their defaults (they reject "updates")', async () => {
    const { beta, body } = await captureAnthropicRequest('claude-sonnet-5')
    expect(body.thinking).toBeUndefined()
    expect(beta).not.toContain('thinking-display-updates')
  })

  test('model matching', () => {
    expect(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2'].every(supportsProgressUpdates)).toBe(true)
    expect(['claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-8', 'gpt-5'].some(supportsProgressUpdates)).toBe(false)
  })
})
