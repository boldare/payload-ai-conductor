import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Two-step confirmation for MCP writes. In the embedded chat, the UI itself gates apply_proposal
 * behind an Approve button; over MCP the server can't show anything to the human, so instead
 * propose_layout/revise_proposal hand back a token that is only valid for *exactly* the arguments
 * they validated (and the user who asked). apply_proposal refuses without it — an agent can't write
 * content that never went through validation and the client's own approval step, and can't swap in
 * different content after the user approved a proposal.
 */

const TOKEN_TTL_MS = 30 * 60 * 1000

export type TokenArgs = {
  collection: string
  data?: Record<string, unknown>
  id?: number | string
  locale?: string
  operations?: unknown[]
}

/** JSON with sorted object keys, so semantically equal arguments always produce the same string. */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

const normalize = (args: TokenArgs) => ({
  id: args.id === undefined || args.id === null || args.id === '' ? null : String(args.id),
  collection: args.collection,
  data: args.data ?? {},
  locale: args.locale ?? null,
  operations: args.operations ?? [],
})

const sign = (secret: string, args: TokenArgs, userId: string, expiresAt: number): string =>
  createHmac('sha256', secret)
    .update(canonicalJson({ args: normalize(args), expiresAt, userId }))
    .digest('base64url')

export const createProposalToken = (secret: string, args: TokenArgs, userId: string, now = Date.now()): string => {
  const expiresAt = now + TOKEN_TTL_MS
  return `${expiresAt}.${sign(secret, args, userId, expiresAt)}`
}

export type TokenCheck = 'expired' | 'malformed' | 'mismatch' | 'ok'

export const verifyProposalToken = (
  secret: string,
  token: string,
  args: TokenArgs,
  userId: string,
  now = Date.now(),
): TokenCheck => {
  const [expiresRaw, signature, ...rest] = token.split('.')
  const expiresAt = Number(expiresRaw)
  if (rest.length > 0 || !signature || !Number.isFinite(expiresAt)) {
    return 'malformed'
  }
  const expected = Buffer.from(sign(secret, args, userId, expiresAt))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return 'mismatch'
  }
  return now > expiresAt ? 'expired' : 'ok'
}
