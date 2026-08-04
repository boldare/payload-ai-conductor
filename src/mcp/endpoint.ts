import type { AuthInfo, McpHttpHandler } from '@modelcontextprotocol/server'
import type { Payload, PayloadHandler, TypedUser } from 'payload'

import { createMcpHandler } from '@modelcontextprotocol/server'

import type { PayloadAiConductorConfig } from '../index.js'

import { buildMcpServer } from './server.js'

const handlerCache = new WeakMap<Payload, McpHttpHandler>()

const getHandler = (payload: Payload, options: PayloadAiConductorConfig): McpHttpHandler => {
  let handler = handlerCache.get(payload)
  if (!handler) {
    handler = createMcpHandler(buildMcpServer(payload, options))
    handlerCache.set(payload, handler)
  }
  return handler
}

const buildAuthInfo = (user: TypedUser): AuthInfo => ({
  clientId: String(user.id),
  extra: { user },
  scopes: [],
  token: 'payload-session',
})

export const createMcpEndpointHandler = (options: PayloadAiConductorConfig): PayloadHandler => {
  return async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const handler = getHandler(req.payload, options)
    return handler.fetch(req as unknown as Request, { authInfo: buildAuthInfo(req.user) })
  }
}
