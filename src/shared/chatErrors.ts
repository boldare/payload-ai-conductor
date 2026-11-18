/**
 * Error contract between the chat endpoint and the chat UI. Kept free of server imports so the
 * client bundle can use it. The endpoint sends `{ code, message }` (JSON) either as a non-200 body
 * (configuration problems caught before streaming) or as the stream's error text (provider errors
 * mid-turn); the UI turns the code into an explanation instead of a bare "An error occurred.".
 */
export type ChatErrorCode =
  | 'connection_failed'
  | 'invalid_api_key'
  | 'model_not_configured'
  | 'model_not_found'
  | 'provider_error'
  | 'rate_limited'
  | 'timeout'
  | 'unknown'

export type ChatErrorPayload = { code: ChatErrorCode; message: string }

const CODES: ReadonlySet<string> = new Set<ChatErrorCode>([
  'connection_failed',
  'invalid_api_key',
  'model_not_configured',
  'model_not_found',
  'provider_error',
  'rate_limited',
  'timeout',
  'unknown',
])

export const serializeChatError = (payload: ChatErrorPayload): string => JSON.stringify(payload)

const asPayload = (value: unknown): ChatErrorPayload | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const record = value as { code?: unknown; error?: unknown; message?: unknown }
  if (typeof record.code === 'string' && CODES.has(record.code)) {
    return { code: record.code as ChatErrorCode, message: typeof record.message === 'string' ? record.message : '' }
  }
  return record.error ? asPayload(record.error) : undefined
}

/**
 * Recover the structured error from whatever reached the client: our JSON (stream error text or a
 * non-200 body), or — from an older server or a proxy in between — plain text, matched loosely.
 */
export const parseChatError = (raw: string): ChatErrorPayload => {
  try {
    const parsed = asPayload(JSON.parse(raw))
    if (parsed) {
      return parsed
    }
  } catch {
    // not JSON — fall through to text matching
  }
  if (/no model configured/i.test(raw)) {
    return { code: 'model_not_configured', message: raw }
  }
  if (/x-api-key|api key|authentication|unauthorized|\b401\b/i.test(raw)) {
    return { code: 'invalid_api_key', message: raw }
  }
  if (/cannot connect|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(raw)) {
    return { code: 'connection_failed', message: raw }
  }
  return { code: 'unknown', message: raw }
}
