import type { Block, Field, Option } from 'payload'

import { z } from 'zod'

export type RelationshipRef = { collection: string; id: number | string }

type ShapeEntry = { key: string; schema: z.ZodTypeAny }

const optionValue = (option: Option): string => (typeof option === 'string' ? option : option.value)

const fieldValueSchema = (field: { name: string } & Field): z.ZodTypeAny => {
  switch (field.type) {
    case 'array':
      return z.array(buildFieldsSchema(field.fields))
    case 'blocks':
      return buildBlocksFieldSchema(field.blocks)
    case 'checkbox':
      return z.boolean()
    case 'group':
      return buildFieldsSchema(field.fields)
    case 'number':
      return z.number()
    case 'radio': {
      const values = field.options.map(optionValue)
      return values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string()
    }
    case 'relationship':
    case 'upload': {
      const id = z.union([z.string(), z.number()])
      const single = Array.isArray(field.relationTo)
        ? z.object({ relationTo: z.enum(field.relationTo as [string, ...string[]]), value: id })
        : id
      return field.hasMany ? z.array(single) : single
    }
    case 'select': {
      const values = field.options.map(optionValue)
      const base = values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string()
      return field.hasMany ? z.array(base) : base
    }
    default:
      // text, textarea, email, date, richText, code, json, point, etc — loosely typed for v1
      return z.any()
  }
}

const fieldToShapeEntries = (field: Field): ShapeEntry[] => {
  if (field.type === 'row' || field.type === 'collapsible') {
    return fieldsToShapeEntries(field.fields)
  }

  if (field.type === 'tabs') {
    return field.tabs.flatMap((tab) =>
      'name' in tab && tab.name
        ? [{ key: tab.name, schema: buildFieldsSchema(tab.fields).partial() }]
        : fieldsToShapeEntries(tab.fields),
    )
  }

  if (field.type === 'ui' || !('name' in field)) {
    return []
  }

  const valueSchema = fieldValueSchema(field)
  return [{ key: field.name, schema: field.required ? valueSchema : valueSchema.optional() }]
}

const fieldsToShapeEntries = (fields: Field[]): ShapeEntry[] => fields.flatMap(fieldToShapeEntries)

export const buildFieldsSchema = (fields: Field[]): z.ZodObject<Record<string, z.ZodTypeAny>> => {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const entry of fieldsToShapeEntries(fields)) {
    shape[entry.key] = entry.schema
  }
  return z.object(shape)
}

export const buildBlockSchema = (block: Block): z.ZodObject<Record<string, z.ZodTypeAny>> => {
  return buildFieldsSchema(block.fields).extend({
    id: z.union([z.string(), z.number()]).optional(),
    blockType: z.literal(block.slug),
  })
}

export const buildBlocksFieldSchema = (blocks: Block[]): z.ZodTypeAny => {
  if (blocks.length === 0) {
    return z.array(z.never())
  }
  if (blocks.length === 1) {
    return z.array(buildBlockSchema(blocks[0]))
  }
  return z.array(
    z.discriminatedUnion(
      'blockType',
      blocks.map((block) => buildBlockSchema(block)) as [
        ReturnType<typeof buildBlockSchema>,
        ...ReturnType<typeof buildBlockSchema>[],
      ],
    ),
  )
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
