import type { Block, CollectionConfig, CollectionSlug, Field, TypedLocale } from 'payload'

const DEFAULT_MAX_DEPTH = 5

// Narrower than `Config`/`SanitizedConfig` on purpose: both are structurally
// assignable here, whereas the full types are NOT assignable to each other
// (unrelated `admin` sub-types diverge), and this is all these functions need.
type ConfigWithCollections = { collections?: Array<{ fields: Field[]; slug: string; upload?: unknown }> }

export type FieldSchema = {
  blocks?: BlockSchema[]
  fields?: FieldSchema[]
  hasMany?: boolean
  localized?: boolean
  name: string
  options?: string[]
  relationTo?: string | string[]
  required?: boolean
  type: string
}

export type BlockSchema = {
  fields: FieldSchema[]
  slug: string
  truncated?: boolean
}

const describeField = (field: Field, depth: number, maxDepth: number): FieldSchema[] => {
  if (field.type === 'row' || field.type === 'collapsible') {
    return describeFields(field.fields, depth, maxDepth)
  }

  if (field.type === 'tabs') {
    return field.tabs.flatMap((tab) =>
      'name' in tab && tab.name
        ? [
            {
              name: tab.name,
              type: 'group',
              fields: describeFields(tab.fields, depth, maxDepth),
            },
          ]
        : describeFields(tab.fields, depth, maxDepth),
    )
  }

  if (field.type === 'ui' || !('name' in field)) {
    return []
  }

  const base = {
    name: field.name,
    type: field.type,
    localized: 'localized' in field ? field.localized : undefined,
    required: 'required' in field ? field.required : undefined,
  }

  if (field.type === 'group') {
    return [{ ...base, fields: describeFields(field.fields, depth, maxDepth) }]
  }

  if (field.type === 'array') {
    return [{ ...base, fields: describeFields(field.fields, depth, maxDepth) }]
  }

  if (field.type === 'select' || field.type === 'radio') {
    return [
      {
        ...base,
        options: field.options.map((option) => (typeof option === 'string' ? option : option.value)),
      },
    ]
  }

  if (field.type === 'relationship' || field.type === 'upload') {
    return [{ ...base, hasMany: 'hasMany' in field ? field.hasMany : undefined, relationTo: field.relationTo }]
  }

  if (field.type === 'blocks') {
    return [{ ...base, blocks: field.blocks.map((block) => describeBlock(block, depth, maxDepth)) }]
  }

  return [base]
}

export const describeFields = (fields: Field[], depth = 0, maxDepth = DEFAULT_MAX_DEPTH): FieldSchema[] => {
  return fields.flatMap((field) => describeField(field, depth, maxDepth))
}

export const describeBlock = (block: Block, depth: number, maxDepth = DEFAULT_MAX_DEPTH): BlockSchema => {
  if (depth >= maxDepth) {
    return { slug: block.slug, fields: [], truncated: true }
  }

  return { slug: block.slug, fields: describeFields(block.fields, depth + 1, maxDepth) }
}

export const describeCollection = (collection: CollectionConfig): { fields: FieldSchema[]; slug: string } => {
  return { slug: collection.slug, fields: describeFields(collection.fields) }
}

export const hasBlocksField = (fields: Field[]): boolean => {
  return fields.some((field) => {
    if (field.type === 'blocks') {
      return true
    }

    if (field.type === 'row' || field.type === 'collapsible' || field.type === 'group' || field.type === 'array') {
      return hasBlocksField(field.fields)
    }

    if (field.type === 'tabs') {
      return field.tabs.some((tab) => hasBlocksField(tab.fields))
    }

    return false
  })
}

export const findBlocksFields = (fields: Field[]): Array<{ blocks: Block[]; name: string }> => {
  const results: Array<{ blocks: Block[]; name: string }> = []

  const walk = (walkFields: Field[]) => {
    for (const field of walkFields) {
      if (field.type === 'blocks') {
        results.push({ name: field.name, blocks: field.blocks })
      } else if (
        field.type === 'row' ||
        field.type === 'collapsible' ||
        field.type === 'group' ||
        field.type === 'array'
      ) {
        walk(field.fields)
      } else if (field.type === 'tabs') {
        field.tabs.forEach((tab) => walk(tab.fields))
      }
    }
  }

  walk(fields)
  return results
}

/**
 * Fields Payload adds to every collection itself (timestamps, the drafts status, soft-delete
 * marker). They aren't content: a proposal can't set them, and reads leave them out of `data`.
 */
const SYSTEM_FIELD_NAMES = new Set(['_status', 'createdAt', 'deletedAt', 'id', 'updatedAt'])

/** Top-level fields minus Payload's own system fields — the fields a proposal may write. */
export const contentFields = (fields: Field[]): Field[] =>
  fields.filter((field) => !('name' in field && SYSTEM_FIELD_NAMES.has(field.name)))

/** Data keys the given fields occupy at this level (rows/collapsibles/unnamed tabs+groups flatten). */
export const topLevelDataKeys = (fields: Field[]): string[] =>
  fields.flatMap((field): string[] => {
    if (field.type === 'row' || field.type === 'collapsible') {
      return topLevelDataKeys(field.fields)
    }
    if (field.type === 'tabs') {
      return field.tabs.flatMap((tab) => ('name' in tab && tab.name ? [tab.name] : topLevelDataKeys(tab.fields)))
    }
    if (field.type === 'group' && !('name' in field && field.name)) {
      return topLevelDataKeys(field.fields)
    }
    if (field.type === 'ui' || field.type === 'join' || !('name' in field) || ('virtual' in field && field.virtual)) {
      return []
    }
    return [field.name]
  })

/** A stored document reduced to just its content fields — what a read returns and an edit starts from. */
export const pickContentData = (fields: Field[], doc: Record<string, unknown>): Record<string, unknown> => {
  const picked: Record<string, unknown> = {}
  for (const key of topLevelDataKeys(contentFields(fields))) {
    if (doc[key] !== undefined) {
      picked[key] = doc[key]
    }
  }
  return picked
}

/**
 * `CollectionSlug` is a strict union of a real installation's collection slugs,
 * populated via declaration merging from that installation's generated types.
 * This package's own tsconfig has no such augmentation in scope, so the cast
 * below is a no-op as far as this repo's own type-checking is concerned — it
 * becomes real (and necessary) once this code runs inside any real consumer's
 * project. Only use this after the slug has been checked against the live
 * Payload config (discoverCollections/isCollectionAllowed), never on raw input.
 */
export const asCollectionSlug = (slug: string): CollectionSlug => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- see doc comment above
  return slug as CollectionSlug
}

/**
 * Same reasoning as {@link asCollectionSlug}, for the other consumer-augmented Payload
 * type we accept as a plain string. Deliberately excludes `'all'`: every tool call here
 * carries a single active locale, never "every locale at once".
 */
export const asLocale = (locale: string | undefined): TypedLocale | undefined => {
  return locale as TypedLocale | undefined
}

export const isCollectionAllowed = (collection: string, allowed: CollectionSlug[]): boolean => {
  return allowed.includes(asCollectionSlug(collection))
}

export const discoverCollections = (config: ConfigWithCollections, allowList?: CollectionSlug[]): CollectionSlug[] => {
  const eligible = (config.collections ?? [])
    .filter((collection) => hasBlocksField(collection.fields))
    .map((collection) => asCollectionSlug(collection.slug))

  if (!allowList) {
    return eligible
  }

  const allowed = new Set<CollectionSlug>(allowList)
  return eligible.filter((slug) => allowed.has(slug))
}

export const discoverUploadCollections = (config: ConfigWithCollections): CollectionSlug[] => {
  return (config.collections ?? [])
    .filter((collection) => Boolean(collection.upload))
    .map((collection) => asCollectionSlug(collection.slug))
}
