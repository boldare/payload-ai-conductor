import type { LanguageModel } from 'ai'

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai'

import { ModelConfigError } from './errors.js'

export type ModelConfig = { apiKey: string; model: string; provider: 'anthropic' | 'openai' }

/**
 * Claude models that return the short notes they write between tool calls ("checking the block
 * library…") as `thinking` blocks rather than text — empty by default, so a long tool loop looks
 * silent. `display: "updates"` (beta `thinking-display-updates-2026-08-18`, which the provider adds
 * on its own) returns those notes as text while the reasoning itself stays hidden; the chat UI shows
 * them as the live status line. Claude Opus 5.5, Claude Sonnet 5.5 and the Fable 5.x / Mythos 5.1+
 * models support it; earlier models reject the value, so it's applied only to these.
 */
const PROGRESS_UPDATE_MODELS = /claude-(?:opus-5-5|sonnet-5-5|fable-5|mythos-5-[1-9])/

export const supportsProgressUpdates = (modelId: string): boolean => PROGRESS_UPDATE_MODELS.test(modelId)

export const buildLanguageModel = (config: ModelConfig): LanguageModel => {
  switch (config.provider) {
    case 'anthropic': {
      const model = createAnthropic({ apiKey: config.apiKey })(config.model)
      if (!supportsProgressUpdates(config.model)) {
        return model
      }
      return wrapLanguageModel({
        middleware: defaultSettingsMiddleware({
          settings: { providerOptions: { anthropic: { thinking: { type: 'adaptive', display: 'updates' } } } },
        }),
        model,
      })
    }
    case 'openai':
      return createOpenAI({ apiKey: config.apiKey })(config.model)
    default:
      throw new ModelConfigError(`AI Conductor: unsupported provider "${String(config.provider)}"`)
  }
}

export const resolveModelConfigFromEnv = (): ModelConfig => {
  const provider = process.env.AI_CONDUCTOR_PROVIDER?.trim()
  const apiKey = process.env.AI_CONDUCTOR_API_KEY?.trim()
  const model = process.env.AI_CONDUCTOR_MODEL?.trim()

  if ((provider !== 'anthropic' && provider !== 'openai') || !apiKey || !model) {
    throw new ModelConfigError(
      'AI Conductor: no model configured. Set AI_CONDUCTOR_PROVIDER ("anthropic"|"openai"), AI_CONDUCTOR_API_KEY, ' +
        'and AI_CONDUCTOR_MODEL, or pass `getModelConfig` in the plugin options.',
    )
  }

  return { apiKey, model, provider }
}
