import type { Payload, TypedUser } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createUploadEndpointHandler } from '../src/agent/uploadEndpoint.js'
import { uploadAttachment } from '../src/tools/upload.js'
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

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

describe('uploadAttachment', () => {
  test('uploads to the default (first discovered) upload collection', async () => {
    const result = await uploadAttachment(
      payload,
      { data: pngBytes, mimeType: 'image/png', name: 'pixel.png' },
      { user },
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.collection).toBe('media')
      expect(typeof result.id).not.toBe('undefined')
    }
  })
})

describe('upload endpoint', () => {
  test('rejects unauthenticated requests', async () => {
    const handler = createUploadEndpointHandler()
    const req = new Request('http://localhost:3000/api/plugin/ai-conductor/upload', {
      body: new FormData(),
      method: 'POST',
    }) as unknown as Parameters<ReturnType<typeof createUploadEndpointHandler>>[0]
    req.payload = payload
    req.user = null

    const res = await handler(req)
    expect(res.status).toBe(401)
  })

  test('rejects a request with no file', async () => {
    const handler = createUploadEndpointHandler()
    const req = new Request('http://localhost:3000/api/plugin/ai-conductor/upload', {
      body: new FormData(),
      method: 'POST',
    }) as unknown as Parameters<ReturnType<typeof createUploadEndpointHandler>>[0]
    req.payload = payload
    req.user = user

    const res = await handler(req)
    expect(res.status).toBe(400)
  })

  test('rejects a collection that is not upload-enabled', async () => {
    const handler = createUploadEndpointHandler()
    const formData = new FormData()
    formData.set('collection', 'pages')
    formData.set('file', new File([pngBytes], 'pixel.png', { type: 'image/png' }))

    const req = new Request('http://localhost:3000/api/plugin/ai-conductor/upload', {
      body: formData,
      method: 'POST',
    }) as unknown as Parameters<ReturnType<typeof createUploadEndpointHandler>>[0]
    req.payload = payload
    req.user = user

    const res = await handler(req)
    expect(res.status).toBe(400)
  })

  test('uploads a real file end to end and returns an absolute url', async () => {
    const handler = createUploadEndpointHandler()
    const formData = new FormData()
    formData.set('file', new File([pngBytes], 'pixel.png', { type: 'image/png' }))

    const req = new Request('http://localhost:3400/api/plugin/ai-conductor/upload', {
      body: formData,
      method: 'POST',
    }) as unknown as Parameters<ReturnType<typeof createUploadEndpointHandler>>[0]
    req.payload = payload
    req.user = user

    const res = await handler(req)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { collection: string; id: number | string; url?: string }
    expect(body.collection).toBe('media')
    expect(body.url).toMatch(/^http:\/\/localhost:3400\//)
  })
})
