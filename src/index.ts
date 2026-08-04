import type { Access, CollectionSlug, Config, PayloadRequest } from 'payload'

import type { ModelConfig } from './agent/provider.js'
import type { BlockDocsOption } from './tools/blockMetadata.js'

import { createChatEndpointHandler } from './agent/chatEndpoint.js'
import { createUploadEndpointHandler } from './agent/uploadEndpoint.js'
import { buildConversationsCollection } from './collections/conversations.js'
import { CHAT_ENDPOINT_PATH, CHAT_VIEW_PATH, MCP_ENDPOINT_PATH, UPLOAD_ENDPOINT_PATH } from './constants.js'
import { buildSettingsGlobal } from './globals/settings.js'
import { createMcpEndpointHandler } from './mcp/endpoint.js'
import { discoverCollections } from './tools/schema.js'

export type PayloadAiConductorConfig = {
  /** Explicit markdown docs for specific block slugs, for adopters who keep block docs elsewhere. */
  blockDocs?: BlockDocsOption
  /** Directory to look up `<slug>.md` docs by convention for any block without a `custom.aiConductor`. */
  blocksDir?: string
  /** Restrict AI Conductor to specific collections. Defaults to every collection with a `blocks` field. */
  collections?: CollectionSlug[]
  disabled?: boolean
  /**
   * Resolve the BYOK model config for a chat request. Defaults to the `ai-conductor-settings`
   * Global (configured from the admin UI), falling back to
   * `AI_CONDUCTOR_PROVIDER`/`AI_CONDUCTOR_API_KEY`/`AI_CONDUCTOR_MODEL` env vars if that's unset.
   */
  getModelConfig?: (req: PayloadRequest) => ModelConfig | Promise<ModelConfig>
  /** Maximum number of agent tool-call steps per chat turn, as a runaway-loop guardrail. */
  maxSteps?: number
  /**
   * Restrict who can view/edit the `ai-conductor-settings` global, which holds your decrypted BYOK
   * API key. Defaults to Payload's own default for an unset global (any logged-in user) — that's
   * almost certainly broader than you want for a real API credential, so set this to your own
   * admin/staff check, e.g. `({ req }) => req.user?.role === 'admin'`.
   */
  settingsAccess?: Access
}

export { CHAT_ENDPOINT_PATH, CHAT_VIEW_PATH, MCP_ENDPOINT_PATH, UPLOAD_ENDPOINT_PATH } from './constants.js'

export const payloadAiConductor =
  (pluginOptions: PayloadAiConductorConfig = {}) =>
  (config: Config): Config => {
    if (pluginOptions.disabled) {
      return config
    }

    if (!config.endpoints) {
      config.endpoints = []
    }
    if (!config.globals) {
      config.globals = []
    }

    const allowedCollections = discoverCollections(config, pluginOptions.collections)
    config.globals.push(buildSettingsGlobal(allowedCollections, pluginOptions.settingsAccess))

    if (!config.collections) {
      config.collections = []
    }
    config.collections.push(buildConversationsCollection(config.admin?.user ?? 'users'))

    const mcpHandler = createMcpEndpointHandler(pluginOptions)
    const chatHandler = createChatEndpointHandler(pluginOptions)
    const uploadHandler = createUploadEndpointHandler()

    config.endpoints.push(
      { handler: mcpHandler, method: 'get', path: MCP_ENDPOINT_PATH },
      { handler: mcpHandler, method: 'post', path: MCP_ENDPOINT_PATH },
      { handler: mcpHandler, method: 'delete', path: MCP_ENDPOINT_PATH },
      { handler: chatHandler, method: 'post', path: CHAT_ENDPOINT_PATH },
      { handler: uploadHandler, method: 'post', path: UPLOAD_ENDPOINT_PATH },
    )

    if (!config.admin) {
      config.admin = {}
    }
    if (!config.admin.components) {
      config.admin.components = {}
    }
    if (!config.admin.components.views) {
      config.admin.components.views = {}
    }
    if (!config.admin.components.afterNavLinks) {
      config.admin.components.afterNavLinks = []
    }

    config.admin.components.views.aiConductorChat = {
      Component: 'payload-ai-conductor/rsc#ConductorChatPage',
      path: CHAT_VIEW_PATH,
    }
    config.admin.components.afterNavLinks.push('payload-ai-conductor/rsc#ConductorNavLink')

    for (const slug of allowedCollections) {
      const collection = config.collections?.find((c) => c.slug === slug)
      if (!collection) {
        continue
      }
      if (!collection.admin) {
        collection.admin = {}
      }
      if (!collection.admin.components) {
        collection.admin.components = {}
      }
      if (!collection.admin.components.edit) {
        collection.admin.components.edit = {}
      }
      if (!collection.admin.components.edit.beforeDocumentControls) {
        collection.admin.components.edit.beforeDocumentControls = []
      }
      collection.admin.components.edit.beforeDocumentControls.push({
        exportName: 'AskConductorButton',
        path: 'payload-ai-conductor/rsc',
        serverProps: { collection: slug },
      })
    }

    return config
  }
