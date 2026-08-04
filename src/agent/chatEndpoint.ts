import type { LanguageModel, UIMessage } from 'ai'
import type { PayloadHandler } from 'payload'

import { convertToModelMessages, hasToolCall, stepCountIs, streamText } from 'ai'

import type { PayloadAiConductorConfig } from '../index.js'
import type { ModelConfig } from './provider.js'

import { getSettings, resolveModelConfigFromSettings } from '../globals/settings.js'
import { recordConversationMessages } from '../tools/audit.js'
import { buildLanguageModel, resolveModelConfigFromEnv } from './provider.js'
import { buildAgentTools } from './tools.js'

const DEFAULT_MAX_STEPS = 12

export const SYSTEM_PROMPT = [
  'You are AI Conductor, an assistant that composes and edits pages using the site’s own block library.',
  'Ground every layout in the real block schema: call list_blocks/get_block_schema before proposing content, and',
  'search_documents before referencing any relationship or media field — never invent an id.',
  'Always call propose_layout (or revise_proposal) first and show the result to the user. Only call apply_proposal',
  'after the user has explicitly approved the current proposal.',
  'A user message may include a line like `[Attached: <collection>#<id> "filename"]` — that file has already been',
  'uploaded to that collection by the user, so its id is real and may be used directly in a relationship or upload',
  'field via propose_layout, with no need to call search_documents for it. Any image attached this way is also',
  'included inline in the message for you to look at.',
].join(' ')

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

    const body = (await (req as Request).json()) as { id?: string; messages: UIMessage[] }
    const conversationId = body.id
    const settings = await getSettings(req.payload)

    const modelConfig = options.getModelConfig
      ? await options.getModelConfig(req)
      : resolveModelConfigFromSettings(settings) ?? resolveModelConfigFromEnv()
    const model = resolveModel(modelConfig)
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
      system: SYSTEM_PROMPT,
      toolApproval: { apply_proposal: 'user-approval' },
      tools,
    })

    return result.toUIMessageStreamResponse({
      onFinish: conversationId
        ? ({ messages }) => recordConversationMessages(req.payload, messages, { conversationId, user })
        : undefined,
      // Required so a resumed tool-approval turn continues the same assistant message (and its
      // existing tool call) instead of starting a new one the client can't reconcile.
      originalMessages: body.messages,
    })
  }
}
