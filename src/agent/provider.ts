import type { LanguageModel } from 'ai'

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'

export type ModelConfig = { apiKey: string; model: string; provider: 'anthropic' | 'openai' }

export const buildLanguageModel = (config: ModelConfig): LanguageModel => {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey })(config.model)
    case 'openai':
      return createOpenAI({ apiKey: config.apiKey })(config.model)
    default:
      throw new Error(`AI Conductor: unsupported provider "${String(config.provider)}"`)
  }
}

export const resolveModelConfigFromEnv = (): ModelConfig => {
  const provider = process.env.AI_CONDUCTOR_PROVIDER
  const apiKey = process.env.AI_CONDUCTOR_API_KEY
  const model = process.env.AI_CONDUCTOR_MODEL

  if ((provider !== 'anthropic' && provider !== 'openai') || !apiKey || !model) {
    throw new Error(
      'AI Conductor: no model configured. Set AI_CONDUCTOR_PROVIDER ("anthropic"|"openai"), AI_CONDUCTOR_API_KEY, ' +
        'and AI_CONDUCTOR_MODEL, or pass `getModelConfig` in the plugin options.',
    )
  }

  return { apiKey, model, provider }
}
