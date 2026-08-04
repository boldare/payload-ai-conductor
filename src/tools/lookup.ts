import type { Payload, TypedUser } from 'payload'

import { asCollectionSlug, asLocale } from './schema.js'

export type LookupContext = { locale?: string; user?: TypedUser }

export type LookupResult = { collection: string; id: number | string; label: string }

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
