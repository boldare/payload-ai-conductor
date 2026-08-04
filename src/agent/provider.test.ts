import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { buildLanguageModel, resolveModelConfigFromEnv } from './provider.js'

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
