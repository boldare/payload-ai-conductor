import type { Block, Field, Option } from 'payload'

import { z } from 'zod'

export type RelationshipRef = { collection: string; id: number | string }

type ShapeEntry = { key: string; schema: z.ZodType }

type FieldWithName = { name: string } & Field

const idSchema = z.union([z.string(), z.number()])

const optionValue = (option: Option): string => (typeof option === 'string' ? option : option.value)

const hasDefaultValue = (field: Field): boolean =>
  'defaultValue' in field && field.defaultValue !== undefined && field.defaultValue !== null

/**
 * Mirrors what Payload enforces on save: `required` means "must have a value", except that a
 * `defaultValue` fills it in when omitted — so a required field with a default isn't required input.
 */
const isRequired = (field: Field): boolean => 'required' in field && field.required === true && !hasDefaultValue(field)

/** Same semantics as Payload's own `validateArrayLength` (array/blocks/hasMany fields). */
const withRowLimits = <T extends z.ZodType<unknown[]>>(
  schema: T,
  { maxRows, minRows, required }: { maxRows?: number; minRows?: number; required: boolean },
) =>
  schema.superRefine((value, ctx) => {
    const length = value.length
    if (!required && length === 0) {
      return
    }
    if (minRows && length < minRows) {
      ctx.addIssue({ code: 'custom', message: `needs at least ${minRows} item(s), got ${length}` })
    }
    if (maxRows && length > maxRows) {
      ctx.addIssue({ code: 'custom', message: `allows at most ${maxRows} item(s), got ${length}` })
    }
    if (required && length === 0) {
      ctx.addIssue({ code: 'custom', message: 'needs at least 1 item' })
    }
  })

const stringSchema = (field: { maxLength?: number; minLength?: number }, required: boolean): z.ZodString => {
  let schema = z.string()
  if (required) {
    schema = schema.min(1, 'is required')
  }
  if (typeof field.minLength === 'number') {
    schema = schema.min(field.minLength, `must be at least ${field.minLength} characters`)
  }
  if (typeof field.maxLength === 'number') {
    schema = schema.max(field.maxLength, `must be at most ${field.maxLength} characters`)
  }
  return schema
}

const fieldValueSchema = (field: FieldWithName, required: boolean): z.ZodType => {
  switch (field.type) {
    case 'array':
      return withRowLimits(z.array(buildRowSchema(field.fields)), {
        maxRows: field.maxRows,
        minRows: field.minRows,
        required,
      })
    case 'blocks':
      return withRowLimits(buildBlocksFieldSchema(field.blocks), {
        maxRows: field.maxRows,
        minRows: field.minRows,
        required,
      })
    case 'checkbox':
      return z.boolean()
    case 'code':
    case 'date':
      return z.string()
    case 'email':
      return stringSchema({}, required)
    case 'group':
      return buildFieldsSchema(field.fields)
    case 'number': {
      let single = z.number()
      if (typeof field.min === 'number') {
        single = single.min(field.min, `must be ≥ ${field.min}`)
      }
      if (typeof field.max === 'number') {
        single = single.max(field.max, `must be ≤ ${field.max}`)
      }
      return field.hasMany
        ? withRowLimits(z.array(single), { maxRows: field.maxRows, minRows: field.minRows, required })
        : single
    }
    case 'point':
      return z.tuple([z.number(), z.number()])
    case 'radio': {
      const values = field.options.map(optionValue)
      return values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string()
    }
    case 'relationship':
    case 'upload': {
      const single = Array.isArray(field.relationTo)
        ? z.strictObject({ relationTo: z.enum(field.relationTo as [string, ...string[]]), value: idSchema })
        : idSchema
      return field.hasMany
        ? withRowLimits(z.array(single), {
            maxRows: 'maxRows' in field ? field.maxRows : undefined,
            minRows: 'minRows' in field ? field.minRows : undefined,
            required,
          })
        : single
    }
    case 'select': {
      const values = field.options.map(optionValue)
      const base = values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string()
      return field.hasMany ? z.array(base) : base
    }
    case 'text': {
      const single = stringSchema(field, required && !field.hasMany)
      return field.hasMany
        ? withRowLimits(z.array(single), { maxRows: field.maxRows, minRows: field.minRows, required })
        : single
    }
    case 'textarea':
      return stringSchema(field, required)
    default:
      // json, richText, and anything newer — structure is editor/field-specific, so only presence
      // (required) is checked here; Payload validates the rest on save.
      return z.any().refine((value) => value !== undefined && value !== null, 'is required')
  }
}

/**
 * Fields that never take input: `join` fields are computed from other collections, and `virtual`
 * fields aren't stored. Leaving them out of the schema means a proposal that sets one is rejected as
 * an unknown field instead of silently doing nothing.
 */
const isWritableField = (field: Field): boolean =>
  field.type !== 'join' && !('virtual' in field && field.virtual === true)

const fieldToShapeEntries = (field: Field): ShapeEntry[] => {
  if (field.type === 'row' || field.type === 'collapsible') {
    return fieldsToShapeEntries(field.fields)
  }

  if (field.type === 'tabs') {
    return field.tabs.flatMap((tab) =>
      'name' in tab && tab.name
        ? [{ key: tab.name, schema: optionalContainer(buildFieldsSchema(tab.fields)) }]
        : fieldsToShapeEntries(tab.fields),
    )
  }

  // Unnamed groups are purely presentational in Payload 3: their fields live at the parent level.
  if (field.type === 'group' && !('name' in field && field.name)) {
    return fieldsToShapeEntries(field.fields)
  }

  if (field.type === 'ui' || !('name' in field) || !isWritableField(field)) {
    return []
  }

  if (field.type === 'group') {
    return [{ key: field.name, schema: optionalContainer(buildFieldsSchema(field.fields)) }]
  }

  const required = isRequired(field)
  const valueSchema = fieldValueSchema(field, required)
  return [{ key: field.name, schema: required ? valueSchema : valueSchema.nullish() }]
}

/**
 * A group (or named tab) may be omitted as a whole — but if any field inside it is required, that's
 * still a missing required value, so validate an omitted container as `{}` rather than skipping it.
 */
const optionalContainer = (schema: z.ZodType): z.ZodType =>
  z.preprocess((value) => (value === undefined || value === null ? {} : value), schema)

const fieldsToShapeEntries = (fields: Field[]): ShapeEntry[] => fields.flatMap(fieldToShapeEntries)

/**
 * Strict object schema for a set of fields: unknown keys are rejected (with the offending key in
 * the message) instead of being silently dropped, so a typo'd or invented field name fails at
 * propose time rather than vanishing on save.
 */
export const buildFieldsSchema = (fields: Field[]): z.ZodObject => {
  const shape: Record<string, z.ZodType> = {}
  for (const entry of fieldsToShapeEntries(fields)) {
    shape[entry.key] = entry.schema
  }
  return z.strictObject(shape)
}

/** Array rows carry a Payload-generated `id` once saved; allow it so a read-modify-write round trips. */
const buildRowSchema = (fields: Field[]): z.ZodObject => buildFieldsSchema(fields).extend({ id: idSchema.nullish() })

export const buildBlockSchema = (block: Block): z.ZodObject => {
  return buildFieldsSchema(block.fields).extend({
    id: idSchema.nullish(),
    blockName: z.string().nullish(),
    blockType: z.literal(block.slug),
  })
}

/**
 * Hand-rolled instead of `z.discriminatedUnion` so an unknown `blockType` gets a message that names
 * the blocks that *are* available, and every nested issue keeps a precise path into the array.
 */
export const buildBlocksFieldSchema = (blocks: Block[]): z.ZodType<unknown[]> => {
  const schemas = new Map(blocks.map((block) => [block.slug, buildBlockSchema(block)]))
  const available = blocks.map((block) => block.slug).join(', ') || '(none)'

  return z.array(z.unknown()).superRefine((items, ctx) => {
    items.forEach((item, index) => {
      const blockType =
        typeof item === 'object' && item !== null ? (item as Record<string, unknown>).blockType : undefined
      const schema = typeof blockType === 'string' ? schemas.get(blockType) : undefined
      if (!schema) {
        ctx.addIssue({
          code: 'custom',
          message:
            blockType === undefined
              ? `is missing "blockType" (available: ${available})`
              : `unknown blockType ${JSON.stringify(blockType)} (available: ${available})`,
          path: [index, 'blockType'],
        })
        return
      }
      const result = schema.safeParse(item, { reportInput: true })
      if (!result.success) {
        // Format here, while the issue still carries its own `input` — re-adding it through `ctx`
        // would replace that with the whole array and lose the "is required" distinction.
        for (const issue of result.error.issues) {
          ctx.addIssue({ code: 'custom', message: formatIssueMessage(issue), path: [index, ...issue.path] })
        }
      }
    })
  })
}

/**
 * Renders a validation issue path so the model can find the problem without counting array
 * indexes: `layout[1:cta].buttonHref` instead of `layout.1.buttonHref`.
 */
const formatIssuePath = (path: PropertyKey[], data: unknown): string => {
  let rendered = ''
  let cursor: unknown = data
  for (const segment of path) {
    if (typeof segment === 'number') {
      cursor = Array.isArray(cursor) ? cursor[segment] : undefined
      const blockType =
        typeof cursor === 'object' && cursor !== null ? (cursor as Record<string, unknown>).blockType : undefined
      rendered += typeof blockType === 'string' ? `[${segment}:${blockType}]` : `[${segment}]`
    } else {
      cursor = typeof cursor === 'object' && cursor !== null ? (cursor as Record<string, unknown>)[segment as string] : undefined
      rendered += rendered ? `.${String(segment)}` : String(segment)
    }
  }
  return rendered || '(root)'
}

const formatIssueMessage = (issue: z.core.$ZodIssue): string => {
  if (issue.code === 'unrecognized_keys') {
    return `unknown field(s) ${issue.keys.map((key) => `"${key}"`).join(', ')} — not in the schema (check get_block_schema / get_collection_schema)`
  }
  if (issue.code === 'invalid_type' && (issue.input === undefined || issue.input === null)) {
    return 'is required'
  }
  return issue.message
}

/** Validate `data` against a full field schema, returning human/agent-readable issues. */
export const validateFieldsData = (fields: Field[], data: unknown): string[] => {
  const result = buildFieldsSchema(fields).safeParse(data, { reportInput: true })
  if (result.success) {
    return []
  }
  return result.error.issues.map((issue) => `${formatIssuePath(issue.path, data)}: ${formatIssueMessage(issue)}`)
}

const refFromValue = (value: unknown, relationTo: string | string[]): null | RelationshipRef => {
  if (value == null) {
    return null
  }

  if (Array.isArray(relationTo)) {
    if (typeof value === 'object' && 'relationTo' in value && 'value' in value) {
      const polymorphic = value as { relationTo: string; value: number | string }
      return { id: polymorphic.value, collection: polymorphic.relationTo }
    }
    return null
  }

  return { id: value as number | string, collection: relationTo }
}

const collectFieldRefs = (field: Field, value: unknown): RelationshipRef[] => {
  if (field.type === 'row' || field.type === 'collapsible') {
    return collectFieldsRefs(field.fields, value)
  }

  if (field.type === 'group' && !('name' in field && field.name)) {
    return collectFieldsRefs(field.fields, value)
  }

  if (field.type === 'tabs') {
    const record = (value ?? {}) as Record<string, unknown>
    return field.tabs.flatMap((tab) =>
      'name' in tab && tab.name ? collectFieldsRefs(tab.fields, record[tab.name]) : collectFieldsRefs(tab.fields, value),
    )
  }

  if (field.type === 'ui' || !('name' in field)) {
    return []
  }

  const fieldValue = (value as Record<string, unknown> | undefined)?.[field.name]
  if (fieldValue == null) {
    return []
  }

  if (field.type === 'group') {
    return collectFieldsRefs(field.fields, fieldValue)
  }

  if (field.type === 'array') {
    return (fieldValue as unknown[]).flatMap((item) => collectFieldsRefs(field.fields, item))
  }

  if (field.type === 'blocks') {
    return (fieldValue as Array<Record<string, unknown>>).flatMap((blockData) => {
      const block = field.blocks.find((b) => b.slug === blockData.blockType)
      return block ? collectFieldsRefs(block.fields, blockData) : []
    })
  }

  if (field.type === 'relationship' || field.type === 'upload') {
    const values = field.hasMany ? (fieldValue as unknown[]) : [fieldValue]
    return values
      .map((v) => refFromValue(v, field.relationTo))
      .filter((ref): ref is RelationshipRef => ref !== null)
  }

  return []
}

export const collectFieldsRefs = (fields: Field[], data: unknown): RelationshipRef[] => {
  return fields.flatMap((field) => collectFieldRefs(field, data))
}
