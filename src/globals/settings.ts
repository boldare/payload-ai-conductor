import type { Access, CollectionSlug, FieldHook, GlobalConfig, Payload } from 'payload'

import type { ModelConfig } from '../agent/provider.js'
import type { PayloadAiConductorConfig } from '../index.js'

import { asCollectionSlug } from '../tools/schema.js'

export const SETTINGS_GLOBAL_SLUG = 'ai-conductor-settings'

export type AiConductorSettings = {
  apiKey?: string
  collections?: string[]
  debugMode?: boolean
  maxSteps?: number
  model?: string
  provider?: 'anthropic' | 'openai'
  timeoutMs?: number
}

const encryptApiKey: FieldHook = ({ req, value }) => {
  if (!value || typeof value !== 'string') {
    return value
  }
  return req.payload.encrypt(value)
}

const decryptApiKey: FieldHook = ({ req, value }) => {
  if (!value || typeof value !== 'string') {
    return value
  }
  try {
    return req.payload.decrypt(value)
  } catch {
    return undefined
  }
}

// `collectionOptions` are the collections the plugin config already permits (see the doc comment
// on resolveAllowedCollections below) — rendered as real select options instead of a freeform text
// field, so there's actually something to pick from instead of an empty "Select a value" combobox.
//
// `access` gates read/update of this global. Payload's own default for an unset global access rule
// is "any logged-in user" (see `defaultAccess` in payload/dist/auth/defaultAccess.js) — since this
// global holds a decrypted BYOK API key, that default is almost always broader than intended, so
// callers are expected to pass a real check (see `settingsAccess` on PayloadAiConductorConfig).
export const buildSettingsGlobal = (collectionOptions: string[], access?: Access): GlobalConfig => ({
  slug: SETTINGS_GLOBAL_SLUG,
  access: access ? { read: access, update: access } : undefined,
  admin: {
    description: 'Bring-your-own-key model provider, collection scope, and safety guardrails for AI Conductor.',
  },
  fields: [
    {
      name: 'provider',
      type: 'select',
      defaultValue: 'anthropic',
      options: [
        { label: 'Anthropic', value: 'anthropic' },
        { label: 'OpenAI', value: 'openai' },
      ],
    },
    {
      name: 'model',
      type: 'text',
      admin: { description: 'e.g. claude-sonnet-5, gpt-4o' },
    },
    {
      name: 'apiKey',
      type: 'text',
      admin: {
        description: access
          ? 'Stored encrypted at rest. Decrypted for anyone who can view this settings screen.'
          : 'Stored encrypted at rest, but decrypted for ANY logged-in user by default — pass `settingsAccess` to the plugin to restrict this screen to trusted staff.',
      },
      hooks: { afterRead: [decryptApiKey], beforeChange: [encryptApiKey] },
    },
    {
      name: 'collections',
      type: 'select',
      admin: {
        description:
          'Optional — further restrict which collections AI Conductor may use. Leave empty to allow all of the above.',
      },
      hasMany: true,
      options: collectionOptions,
    },
    { name: 'maxSteps', type: 'number', admin: { description: 'Defaults to 12.' }, max: 100, min: 1 },
    { name: 'timeoutMs', type: 'number', admin: { description: 'Per-turn timeout, in milliseconds.' }, min: 1000 },
    {
      name: 'debugMode',
      type: 'checkbox',
      admin: {
        description:
          'Show every tool call (list_blocks, propose_layout, etc.) in the chat, including raw JSON output. Off by default to keep the chat conversational — pending approvals are always shown regardless of this setting.',
      },
      defaultValue: false,
    },
  ],
})

export const getSettings = async (payload: Payload): Promise<AiConductorSettings> => {
  const settings = await payload.findGlobal({ slug: SETTINGS_GLOBAL_SLUG, overrideAccess: true })
  return settings as AiConductorSettings
}

/**
 * Settings' `collections` is a live, admin-editable override; the plugin option is the
 * developer's config-time baseline. The Global can only narrow that baseline, never widen
 * it — an admin can restrict scope from the UI, but can't grant access beyond what the
 * developer already allowed via code.
 */
export const resolveAllowedCollections = (
  options: PayloadAiConductorConfig,
  settings: AiConductorSettings,
): CollectionSlug[] | undefined => {
  const settingsCollections = settings.collections?.filter(Boolean)
  if (!settingsCollections?.length) {
    return options.collections
  }
  if (!options.collections) {
    return settingsCollections.map(asCollectionSlug)
  }
  return options.collections.filter((slug) => settingsCollections.includes(slug))
}

export const resolveModelConfigFromSettings = (settings: AiConductorSettings): ModelConfig | undefined => {
  if (settings.provider && settings.apiKey && settings.model) {
    return { apiKey: settings.apiKey, model: settings.model, provider: settings.provider }
  }
  return undefined
}
