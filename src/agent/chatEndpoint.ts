import type { LanguageModel, UIMessage } from 'ai'
import type { PayloadHandler } from 'payload'

import { convertToModelMessages, hasToolCall, stepCountIs, streamText } from 'ai'

import type { PayloadAiConductorConfig } from '../index.js'
import type { ModelConfig } from './provider.js'

import { DEFAULT_MAX_STEPS, getSettings, resolveAllowedCollections, resolveModelConfigFromSettings } from '../globals/settings.js'
import { serializeChatError } from '../shared/chatErrors.js'
import { recordConversationMessages } from '../tools/audit.js'
import { discoverCollections, isCollectionAllowed } from '../tools/schema.js'
import { classifyChatError } from './errors.js'
import { buildLanguageModel, resolveModelConfigFromEnv } from './provider.js'
import { buildAgentTools } from './tools.js'

export const SYSTEM_PROMPT = [
  'You are AI Conductor, an assistant that composes and edits pages using the site’s own block library.',
  'Ground every layout in the real block schema: call list_blocks/get_block_schema before proposing content, and',
  'search_documents before referencing any relationship or media field — never invent an id.',
  'To edit an existing document, call get_document first, then propose the edit with its id: changed top-level fields',
  'in `data`, and block changes as `operations` (update/insert/remove/move a block by its id), so blocks you are not',
  'changing stay exactly as they are.',
  'Always call propose_layout (or revise_proposal) first and show the result to the user. Only call apply_proposal',
  'after the user has explicitly approved the current proposal.',
  'A user message may include a line like `[Attached: <collection>#<id> "filename"]` — that file has already been',
  'uploaded to that collection by the user, so its id is real and may be used directly in a relationship or upload',
  'field via propose_layout, with no need to call search_documents for it. Any image attached this way is also',
  'included inline in the message for you to look at.',
].join(' ')

export type DocumentContext = { collection: string; id?: number | string }

const SAFE_ID = /^[\w-]{1,64}$/

/**
 * The document the user opened the chat from ("Ask AI Conductor" on an edit view). Deliberately
 * only the collection and id — never the document's content: the system prompt must stay identical
 * for the whole conversation (Claude 5.5 rejects replayed thinking blocks once it changes), and the
 * content changes as soon as a proposal is applied. The agent reads the current content itself via
 * get_document.
 */
export const buildSystemPrompt = (context?: DocumentContext): string => {
  if (!context) {
    return SYSTEM_PROMPT
  }
  const line =
    context.id !== undefined
      ? `The user opened this chat from the edit view of the "${context.collection}" document with id ` +
        `${JSON.stringify(context.id)}. When they say "this page", "this document" or similar, they mean that ` +
        `document: call get_document for it before proposing changes, and propose edits with that id.`
      : `The user opened this chat while creating a new "${context.collection}" document, so "this page" means a ` +
        `new document in that collection.`
  return `${SYSTEM_PROMPT}\n\n${line}`
}

const parseDocumentContext = (raw: unknown, allowed: ReturnType<typeof discoverCollections>): DocumentContext | undefined => {
  if (typeof raw !== 'object' || raw === null) {
    return undefined
  }
  const { id, collection } = raw as { collection?: unknown; id?: unknown }
  if (typeof collection !== 'string' || !isCollectionAllowed(collection, allowed)) {
    return undefined
  }
  const validId = (typeof id === 'string' || typeof id === 'number') && SAFE_ID.test(String(id)) ? id : undefined
  return { id: validId, collection }
}

export const createChatEndpointHandler = (
  options: PayloadAiConductorConfig,
  deps: { buildLanguageModel?: (config: ModelConfig) => LanguageModel } = {},
): PayloadHandler => {
  const resolveModel = deps.buildLanguageModel ?? buildLanguageModel

  return async (req) => {
    const { user } = req
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await (req as Request).json()) as { context?: unknown; id?: string; messages: UIMessage[] }
    const conversationId = body.id
    const settings = await getSettings(req.payload)

    // Configuration problems are known before anything streams — answer them as a plain JSON error
    // the UI can explain ("no model configured" + a link to Settings) instead of a stream failure.
    let model: LanguageModel
    try {
      const modelConfig = options.getModelConfig
        ? await options.getModelConfig(req)
        : (resolveModelConfigFromSettings(settings) ?? resolveModelConfigFromEnv())
      model = resolveModel(modelConfig)
    } catch (error) {
      return new Response(serializeChatError(classifyChatError(error)), {
        headers: { 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const allowedCollections = discoverCollections(req.payload.config, resolveAllowedCollections(options, settings))
    const documentContext = parseDocumentContext(body.context, allowedCollections)
    const tools = await buildAgentTools(req.payload, options, { conversationId, locale: req.locale ?? undefined, user })

    const maxSteps = settings.maxSteps ?? options.maxSteps ?? DEFAULT_MAX_STEPS
    const timeoutMs = settings.timeoutMs
    const abortSignal =
      timeoutMs && req.signal
        ? AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)])
        : timeoutMs
          ? AbortSignal.timeout(timeoutMs)
          : req.signal

    const result = streamText({
      abortSignal,
      messages: await convertToModelMessages(body.messages),
      model,
      stopWhen: [stepCountIs(maxSteps), hasToolCall('apply_proposal')],
      system: buildSystemPrompt(documentContext),
      toolApproval: { apply_proposal: 'user-approval' },
      tools,
    })

    return result.toUIMessageStreamResponse({
      onError: (error) => serializeChatError(classifyChatError(error)),
      onFinish: conversationId
        ? ({ messages }) => recordConversationMessages(req.payload, messages, { conversationId, user })
        : undefined,
      // Required so a resumed tool-approval turn continues the same assistant message (and its
      // existing tool call) instead of starting a new one the client can't reconcile.
      originalMessages: body.messages,
    })
  }
}
