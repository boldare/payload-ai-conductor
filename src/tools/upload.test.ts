import type { Payload } from 'payload'

import { describe, expect, test } from 'vitest'

import { uploadAttachment } from './upload.js'

describe('uploadAttachment', () => {
  test('rejects when no upload-enabled collection is configured', async () => {
    const payload = { config: { collections: [] } } as unknown as Payload

    const result = await uploadAttachment(payload, {
      name: 'x.png',
      data: Buffer.from('x'),
      mimeType: 'image/png',
    })

    expect(result).toEqual({ issues: ['No upload-enabled collection is configured.'], success: false })
  })

  test('rejects an explicit collection that is not upload-enabled', async () => {
    const payload = { config: { collections: [{ slug: 'media', fields: [], upload: {} }] } } as unknown as Payload

    const result = await uploadAttachment(payload, {
      name: 'x.png',
      collection: 'pages',
      data: Buffer.from('x'),
      mimeType: 'image/png',
    })

    expect(result).toEqual({ issues: ['"pages" is not an upload-enabled collection.'], success: false })
  })
})
