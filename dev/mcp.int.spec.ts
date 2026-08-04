import type { Payload, TypedUser } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createMcpEndpointHandler } from '../src/mcp/endpoint.js'
import { devUser } from './helpers/credentials.js'

let payload: Payload
let user: TypedUser

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'users', where: { email: { equals: devUser.email } } })
  user = docs[0] as TypedUser
})

const jsonRpcRequest = (body: unknown, opts: { authed?: boolean } = { authed: true }) => {
  const req = new Request('http://localhost:3000/api/plugin/ai-conductor/mcp', {
    body: JSON.stringify(body),
    headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    method: 'POST',
  }) as unknown as Parameters<ReturnType<typeof createMcpEndpointHandler>>[0]
  req.payload = payload
  req.user = opts.authed === false ? null : user
  return req
}

// The Streamable HTTP transport answers with SSE ("event: message\ndata: {...}\n\n")
// whenever the client's Accept header allows it, even for a single non-streamed
// result — real MCP clients handle both shapes, so the test helper must too.
const readJsonRpcResult = async (res: Response) => {
  const text = await res.text()
  const dataLine = text
    .split('\n')
    .find((line) => line.startsWith('data:'))
  const raw = dataLine ? dataLine.slice('data:'.length).trim() : text
  return JSON.parse(raw)
}

describe('MCP endpoint', () => {
  test('rejects unauthenticated requests', async () => {
    const handler = createMcpEndpointHandler({})
    const req = jsonRpcRequest({ id: 1, jsonrpc: '2.0', method: 'tools/list' }, { authed: false })

    const res = await handler(req)
    expect(res.status).toBe(401)
  })

  test('lists the registered tools for an authenticated caller', async () => {
    const handler = createMcpEndpointHandler({ collections: ['pages'] })
    const req = jsonRpcRequest({ id: 1, jsonrpc: '2.0', method: 'tools/list' })

    const res = await handler(req)
    expect(res.status).toBe(200)

    const body = await readJsonRpcResult(res)
    const toolNames = body.result.tools.map((t: { name: string }) => t.name)
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'list_collections',
        'get_collection_schema',
        'list_blocks',
        'get_block_schema',
        'search_documents',
        'propose_layout',
        'revise_proposal',
        'apply_proposal',
      ]),
    )
  })

  test('list_collections only reports allow-listed collections', async () => {
    const handler = createMcpEndpointHandler({ collections: ['pages'] })
    const req = jsonRpcRequest({
      id: 2,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: {}, name: 'list_collections' },
    })

    const res = await handler(req)
    const body = await readJsonRpcResult(res)
    const payloadText = body.result.content[0].text
    const parsed = JSON.parse(payloadText)
    expect(parsed.collections).toEqual([{ blocksFields: ['layout'], collection: 'pages' }])
  })

  test('propose_layout validates through the real tool layer', async () => {
    const handler = createMcpEndpointHandler({ collections: ['pages'] })
    const req = jsonRpcRequest({
      id: 3,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: { collection: 'pages', data: { layout: [{ blockType: 'hero' }] } },
        name: 'propose_layout',
      },
    })

    const res = await handler(req)
    const body = await readJsonRpcResult(res)
    expect(body.result.isError).toBe(true)
    const parsed = JSON.parse(body.result.content[0].text)
    expect(parsed.issues.join(' ')).toContain('heading')
  })

  test('propose_layout refuses a collection outside the allow-list', async () => {
    const handler = createMcpEndpointHandler({ collections: ['pages'] })
    const req = jsonRpcRequest({
      id: 4,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: { collection: 'media', data: {} }, name: 'propose_layout' },
    })

    const res = await handler(req)
    const body = await readJsonRpcResult(res)
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('not available')
  })

  test('apply_proposal writes a real document end to end', async () => {
    const handler = createMcpEndpointHandler({ collections: ['pages'] })
    const req = jsonRpcRequest({
      id: 5,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: {
          collection: 'pages',
          data: { title: 'From MCP', slug: 'from-mcp', layout: [{ blockType: 'hero', heading: 'Hi' }] },
        },
        name: 'apply_proposal',
      },
    })

    const res = await handler(req)
    const body = await readJsonRpcResult(res)
    expect(body.result.isError).toBeFalsy()
    const parsed = JSON.parse(body.result.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.doc.title).toBe('From MCP')
  })
})
