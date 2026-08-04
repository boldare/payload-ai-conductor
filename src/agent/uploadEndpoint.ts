import type { PayloadHandler } from 'payload'

import { uploadAttachment } from '../tools/upload.js'

export const createUploadEndpointHandler = (): PayloadHandler => {
  return async (req) => {
    const { user } = req
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await (req as Request).formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return Response.json({ error: 'Missing "file"' }, { status: 400 })
    }

    const collection = formData.get('collection')
    const data = Buffer.from(await file.arrayBuffer())

    const result = await uploadAttachment(
      req.payload,
      { name: file.name, collection: typeof collection === 'string' ? collection : undefined, data, mimeType: file.type },
      { user },
    )

    if (!result.success) {
      return Response.json(result, { status: 400 })
    }

    const origin = req.url ? new URL(req.url).origin : ''
    return Response.json({ ...result, url: result.url ? `${origin}${result.url}` : undefined })
  }
}
