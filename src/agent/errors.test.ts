import { APICallError, RetryError } from 'ai'
import { describe, expect, test } from 'vitest'

import { parseChatError, serializeChatError } from '../shared/chatErrors.js'
import { classifyChatError, ModelConfigError } from './errors.js'

const apiError = (statusCode: number | undefined, message: string, data?: unknown) =>
  new APICallError({ data, message, requestBodyValues: { secret: 'do-not-leak' }, statusCode, url: 'https://api.example' })

describe('classifyChatError', () => {
  test('the three failures seen in the POC each get their own code', () => {
    expect(classifyChatError(new ModelConfigError('AI Conductor: no model configured.'))).toEqual({
      code: 'model_not_configured',
      message: 'AI Conductor: no model configured.',
    })

    const timeout = new RetryError({
      errors: [apiError(undefined, 'Cannot connect to API: connect ETIMEDOUT 1.2.3.4:443')],
      message: 'Failed after 3 attempts',
      reason: 'maxRetriesExceeded',
    })
    expect(classifyChatError(timeout)).toEqual({
      code: 'connection_failed',
      message: 'Cannot connect to API: connect ETIMEDOUT 1.2.3.4:443',
    })

    const badKey = apiError(401, 'Unauthorized', { error: { type: 'authentication_error', message: 'invalid x-api-key' } })
    expect(classifyChatError(badKey)).toEqual({ code: 'invalid_api_key', message: 'invalid x-api-key' })
  })

  test('other provider statuses, timeouts and unknown errors', () => {
    expect(classifyChatError(apiError(404, 'model: claude-x not found')).code).toBe('model_not_found')
    expect(classifyChatError(apiError(429, 'rate limited')).code).toBe('rate_limited')
    expect(classifyChatError(apiError(529, 'overloaded')).code).toBe('provider_error')
    expect(classifyChatError(new DOMException('The operation timed out.', 'TimeoutError')).code).toBe('timeout')
    expect(classifyChatError(new Error('boom'))).toEqual({ code: 'unknown', message: 'boom' })
  })

  test('never includes the request body', () => {
    expect(JSON.stringify(classifyChatError(apiError(400, 'bad request')))).not.toContain('do-not-leak')
  })
})

describe('parseChatError', () => {
  test('round-trips the serialized payload, including a non-200 JSON body', () => {
    const payload = { code: 'invalid_api_key' as const, message: 'invalid x-api-key' }
    expect(parseChatError(serializeChatError(payload))).toEqual(payload)
    expect(parseChatError(JSON.stringify({ error: payload }))).toEqual(payload)
  })

  test('falls back to text matching for plain messages', () => {
    expect(parseChatError('AI Conductor: no model configured. Set …').code).toBe('model_not_configured')
    expect(parseChatError('401 invalid x-api-key').code).toBe('invalid_api_key')
    expect(parseChatError('Cannot connect to API: ETIMEDOUT').code).toBe('connection_failed')
    expect(parseChatError('An error occurred.')).toEqual({ code: 'unknown', message: 'An error occurred.' })
  })
})
