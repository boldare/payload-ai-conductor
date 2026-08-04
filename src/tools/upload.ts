import type { Payload, TypedUser } from 'payload'

import { asCollectionSlug, discoverUploadCollections } from './schema.js'

export type UploadContext = { user?: TypedUser }

export type UploadResult =
  | { collection: string; id: number | string; mimeType: string; name: string; success: true; url?: string }
  | { issues: string[]; success: false }

export const uploadAttachment = async (
  payload: Payload,
  args: { collection?: string; data: Buffer; mimeType: string; name: string },
  context: UploadContext = {},
): Promise<UploadResult> => {
  const uploadCollections = discoverUploadCollections(payload.config)
  const requested = args.collection ? asCollectionSlug(args.collection) : undefined

  if (requested && !uploadCollections.includes(requested)) {
    return { issues: [`"${args.collection}" is not an upload-enabled collection.`], success: false }
  }

  const collection = requested ?? uploadCollections[0]
  if (!collection) {
    return { issues: ['No upload-enabled collection is configured.'], success: false }
  }

  try {
    const doc = (await payload.create({
      collection,
      data: {},
      file: { name: args.name, data: args.data, mimetype: args.mimeType, size: args.data.length },
      overrideAccess: false,
      user: context.user,
    })) as unknown as { id: number | string; url?: string }

    return {
      id: doc.id,
      name: args.name,
      collection,
      mimeType: args.mimeType,
      success: true,
      url: typeof doc.url === 'string' ? doc.url : undefined,
    }
  } catch (error) {
    return { issues: [error instanceof Error ? error.message : 'Failed to upload file'], success: false }
  }
}
