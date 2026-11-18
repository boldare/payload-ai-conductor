import type { ChatErrorCode } from '../../shared/chatErrors.js'

import { parseChatError } from '../../shared/chatErrors.js'

export type ChatErrorCopy = {
  /** The raw provider/server message, for the admin who has to fix it. */
  detail?: string
  hint: string
  showSettingsLink: boolean
  title: string
}

const COPY: Record<ChatErrorCode, Omit<ChatErrorCopy, 'detail'>> = {
  connection_failed: {
    hint: 'The server couldn’t connect to the model provider’s API — check its network, firewall or proxy, then try again.',
    showSettingsLink: false,
    title: 'Can’t reach the model provider',
  },
  invalid_api_key: {
    hint: 'Check the API key in AI Conductor Settings — that it’s complete, current, and for the selected provider.',
    showSettingsLink: true,
    title: 'The model provider rejected the API key',
  },
  model_not_configured: {
    hint: 'Choose a provider, model and API key in AI Conductor Settings (or set the AI_CONDUCTOR_* environment variables).',
    showSettingsLink: true,
    title: 'No AI model is configured',
  },
  model_not_found: {
    hint: 'Check the model id in AI Conductor Settings, e.g. claude-sonnet-5-5.',
    showSettingsLink: true,
    title: 'The configured model wasn’t found',
  },
  provider_error: {
    hint: 'The model provider had a temporary problem. Try again in a moment.',
    showSettingsLink: false,
    title: 'The model provider returned an error',
  },
  rate_limited: {
    hint: 'Too many requests for this API key right now. Wait a moment and try again.',
    showSettingsLink: false,
    title: 'Rate limited by the model provider',
  },
  timeout: {
    hint: 'The turn hit the timeout set in AI Conductor Settings. Try a smaller request, or raise the timeout.',
    showSettingsLink: true,
    title: 'The request took too long',
  },
  unknown: {
    hint: 'Try again. If it keeps happening, the server log has the full error.',
    showSettingsLink: false,
    title: 'Something went wrong',
  },
}

export const describeChatError = (error: Error): ChatErrorCopy => {
  const { code, message } = parseChatError(error.message)
  const copy = COPY[code]
  // The generic stream error text says nothing beyond the title — don't repeat it as "detail".
  const detail = message && message !== 'An error occurred.' ? message : undefined
  return { ...copy, detail }
}
