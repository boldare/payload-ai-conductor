import type { Payload, TypedUser } from 'payload'

import { asCollectionSlug, asLocale, pickContentData } from './schema.js'

export type LookupContext = { locale?: string; user?: TypedUser }

export type LookupResult = { collection: string; id: number | string; label: string }

export type GetDocumentResult =
  | {
      collection: string
      /** Content fields only (no timestamps/status), relationships as ids, every block with its `id`. */
      data: Record<string, unknown>
      id: number | string
      status?: string
      updatedAt?: string
    }
  | { error: string }

export const searchDocuments = async (
  payload: Payload,
  args: { collection: string; limit?: number; query?: string },
  context: LookupContext = {},
): Promise<LookupResult[]> => {
  const collection = asCollectionSlug(args.collection)
  const titleField = payload.collections[collection]?.config.admin?.useAsTitle ?? 'id'

  const { docs } = await payload.find({
    collection,
    limit: args.limit ?? 10,
    locale: asLocale(context.locale),
    overrideAccess: false,
    user: context.user,
    where: args.query ? { [titleField]: { like: args.query } } : undefined,
  })

  return docs.map((doc) => {
    const titleValue = (doc as unknown as Record<string, unknown>)[titleField]
    const label = typeof titleValue === 'number' || typeof titleValue === 'string' ? String(titleValue) : String(doc.id)
    return { id: doc.id, collection: args.collection, label }
  })
}

/**
 * Reads one document the way an edit needs it: depth 0 (relationships as ids, matching what a
 * proposal writes), the latest draft when the collection has drafts (that's what apply_proposal
 * writes to), and the caller's own access rules.
 */
export const getDocument = async (
  payload: Payload,
  args: { collection: string; id: number | string },
  context: LookupContext = {},
): Promise<GetDocumentResult> => {
  const collection = payload.collections[asCollectionSlug(args.collection)]
  if (!collection) {
    return { error: `Unknown collection "${args.collection}"` }
  }
  const versions = collection.config.versions
  const drafts = typeof versions === 'object' && Boolean(versions.drafts)

  try {
    const doc = (await payload.findByID({
      id: args.id,
      collection: asCollectionSlug(args.collection),
      depth: 0,
      draft: drafts,
      locale: asLocale(context.locale),
      overrideAccess: false,
      user: context.user,
    })) as unknown as Record<string, unknown>

    return {
      id: doc.id as number | string,
      collection: args.collection,
      data: pickContentData(collection.config.fields, doc),
      status: typeof doc._status === 'string' ? doc._status : undefined,
      updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : undefined,
    }
  } catch {
    return { error: `${args.collection}#${String(args.id)} does not exist or is not accessible` }
  }
}
