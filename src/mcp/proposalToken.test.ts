import { describe, expect, test } from 'vitest'

import { createProposalToken, verifyProposalToken } from './proposalToken.js'

const args = { id: 12, collection: 'pages', data: { a: 1, b: 2 } }

describe('proposal tokens', () => {
  test('verify for the same arguments and user, regardless of key order or numeric/string id', () => {
    const token = createProposalToken('secret', args, 'user-1')
    expect(verifyProposalToken('secret', token, { id: '12', collection: 'pages', data: { a: 1, b: 2 } }, 'user-1')).toBe(
      'ok',
    )
  })

  test('reject changed content, another user, or another secret', () => {
    const token = createProposalToken('secret', args, 'user-1')
    expect(verifyProposalToken('secret', token, { ...args, data: { a: 1, b: 3 } }, 'user-1')).toBe('mismatch')
    expect(verifyProposalToken('secret', token, args, 'user-2')).toBe('mismatch')
    expect(verifyProposalToken('other', token, args, 'user-1')).toBe('mismatch')
  })

  test('expire after 30 minutes and reject garbage', () => {
    const issuedAt = Date.UTC(2026, 0, 1)
    const token = createProposalToken('secret', args, 'user-1', issuedAt)
    expect(verifyProposalToken('secret', token, args, 'user-1', issuedAt + 29 * 60_000)).toBe('ok')
    expect(verifyProposalToken('secret', token, args, 'user-1', issuedAt + 31 * 60_000)).toBe('expired')
    expect(verifyProposalToken('secret', 'not-a-token', args, 'user-1')).toBe('malformed')
  })
})
