import { APICallError, LoadAPIKeyError, RetryError } from 'ai'

import type { ChatErrorPayload } from '../shared/chatErrors.js'

/** Thrown when no usable model config exists (Settings, env vars and `getModelConfig` all empty). */
export class ModelConfigError extends Error {
  override name = 'ModelConfigError'
}

const NETWORK_CODES = new Set(['EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'])

const hasNetworkCause = (error: unknown): boolean => {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && NETWORK_CODES.has(code)) {
      return true
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** The provider's own explanation (e.g. "invalid x-api-key"), without request bodies or headers. */
const providerMessage = (error: APICallError): string => {
  const data = error.data as { error?: { message?: unknown } } | undefined
  return typeof data?.error?.message === 'string' ? data.error.message : error.message
}

/**
 * Sorts a chat failure into something the UI can explain. The chat screen is only reachable by
 * logged-in admin users, so provider messages are passed through — they're what tells an admin
 * which setting to fix.
 */
export const classifyChatError = (error: unknown): ChatErrorPayload => {
  if (RetryError.isInstance(error)) {
    return classifyChatError(error.lastError)
  }
  if (error instanceof ModelConfigError || LoadAPIKeyError.isInstance(error)) {
    return { code: 'model_not_configured', message: error.message }
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    const message = providerMessage(error)
    if (status === undefined) {
      return { code: 'connection_failed', message }
    }
    if (status === 401 || status === 403) {
      return { code: 'invalid_api_key', message }
    }
    if (status === 404) {
      return { code: 'model_not_found', message }
    }
    if (status === 429) {
      return { code: 'rate_limited', message }
    }
    if (status >= 500) {
      return { code: 'provider_error', message }
    }
    return { code: 'unknown', message }
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { code: 'timeout', message: error.message }
  }
  if (hasNetworkCause(error)) {
    return { code: 'connection_failed', message: error instanceof Error ? error.message : String(error) }
  }
  return { code: 'unknown', message: error instanceof Error ? error.message : String(error) }
}
