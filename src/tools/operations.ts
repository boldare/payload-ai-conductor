import { z } from 'zod'

/**
 * Block-level edits for an existing document. Sending a whole blocks array on update replaces it
 * wholesale — fine for a rewrite, but an easy way for an agent to wipe every block it didn't
 * mention. Operations address blocks by their stored `id` instead, so "change the hero heading"
 * touches exactly one block.
 */
const positionShape = {
  after: z.string().optional().describe('Place right after the block with this id.'),
  before: z.string().optional().describe('Place right before the block with this id.'),
  index: z.number().int().min(0).optional().describe('Zero-based position in the final list.'),
}

const fieldShape = {
  field: z
    .string()
    .optional()
    .describe('Blocks field to edit, e.g. "layout" (dotted for nested: "hero.layout"). Optional when the collection has one.'),
}

export const blockOperationSchema = z.discriminatedUnion('op', [
  z.object({
    ...fieldShape,
    block: z
      .record(z.string(), z.unknown())
      .describe('The new block, including its "blockType". Omit "id" — Payload assigns one.'),
    op: z.literal('insert'),
    ...positionShape,
  }),
  z.object({
    ...fieldShape,
    blockId: z.string(),
    data: z
      .record(z.string(), z.unknown())
      .describe('Fields to set on the block. Each key replaces that field’s value (arrays are replaced whole).'),
    op: z.literal('update'),
  }),
  z.object({ ...fieldShape, blockId: z.string(), op: z.literal('remove') }),
  z.object({ ...fieldShape, blockId: z.string(), op: z.literal('move'), ...positionShape }),
])

export type BlockOperation = z.infer<typeof blockOperationSchema>

type BlockData = { blockType?: unknown; id?: unknown } & Record<string, unknown>

export const getAtPath = (data: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((cursor, key) => {
    return typeof cursor === 'object' && cursor !== null ? (cursor as Record<string, unknown>)[key] : undefined
  }, data)

const setAtPath = (data: Record<string, unknown>, path: string, value: unknown): void => {
  const keys = path.split('.')
  let cursor = data
  for (const key of keys.slice(0, -1)) {
    const next = cursor[key]
    cursor[key] = typeof next === 'object' && next !== null ? { ...(next as Record<string, unknown>) } : {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]] = value
}

const blocksAt = (data: Record<string, unknown>, path: string): BlockData[] => {
  const value = getAtPath(data, path)
  return Array.isArray(value) ? (value as BlockData[]) : []
}

/** Block/row ids are strings or numbers; anything else (null, undefined, objects) counts as "no id". */
export const idOf = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : undefined

/** For messages: a value the model sent, rendered readably even when it isn't a string. */
const show = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value))

const sameId = (a: unknown, b: unknown): boolean => idOf(a) !== undefined && idOf(a) === idOf(b)

export const blockIds = (blocks: BlockData[]): string[] =>
  blocks.map((block) => idOf(block.id)).filter((id): id is string => id !== undefined)

const LABEL_KEYS = ['heading', 'title', 'headline', 'name', 'label', 'quote', 'text', 'authorName']

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** A short human handle for a block ("Welcome to Acme"), for change summaries and error messages. */
export const blockLabel = (block: BlockData): string | undefined => {
  for (const key of LABEL_KEYS) {
    if (typeof block[key] === 'string' && block[key]) {
      return truncate(block[key], 60)
    }
  }
  const firstString = Object.entries(block).find(
    ([key, value]) => !['blockName', 'blockType', 'id'].includes(key) && typeof value === 'string' && value,
  )
  return firstString ? truncate(firstString[1] as string, 60) : undefined
}

export const describeBlock = (block: BlockData): string => {
  const label = blockLabel(block)
  const id = idOf(block.id)
  return `${show(block.blockType)}${label ? ` "${label}"` : ''}${id ? ` (#${id})` : ''}`
}

export type ApplyOperationsResult = {
  data: Record<string, unknown>
  issues: string[]
  /** Block ids each operation removed on purpose, per blocks-field path. */
  removedIds: Map<string, Set<string>>
  /** Blocks-field paths at least one operation changed. */
  touchedPaths: Set<string>
}

export const applyBlockOperations = (
  input: Record<string, unknown>,
  operations: BlockOperation[],
  blocksFieldPaths: string[],
): ApplyOperationsResult => {
  const data = structuredClone(input)
  const issues: string[] = []
  const removedIds = new Map<string, Set<string>>()
  const touchedPaths = new Set<string>()

  operations.forEach((operation, index) => {
    const label = `operations[${index}] (${operation.op})`
    const path = operation.field ?? (blocksFieldPaths.length === 1 ? blocksFieldPaths[0] : undefined)
    if (!path) {
      issues.push(`${label}: "field" is required — this collection has several blocks fields (${blocksFieldPaths.join(', ')})`)
      return
    }
    if (!blocksFieldPaths.includes(path)) {
      issues.push(`${label}: "${path}" is not a blocks field (available: ${blocksFieldPaths.join(', ') || 'none'})`)
      return
    }

    const blocks = [...blocksAt(data, path)]
    const findIndex = (id: string) => blocks.findIndex((block) => sameId(block.id, id))
    const notFound = (id: string) =>
      `${label}: no block with id "${id}" in ${path} (existing ids: ${blockIds(blocks).join(', ') || 'none'}) — call get_document for current ids`

    const resolvePosition = (position: { after?: string; before?: string; index?: number }): number | string => {
      if (position.after !== undefined) {
        const anchor = findIndex(position.after)
        return anchor < 0 ? notFound(position.after) : anchor + 1
      }
      if (position.before !== undefined) {
        const anchor = findIndex(position.before)
        return anchor < 0 ? notFound(position.before) : anchor
      }
      if (position.index !== undefined) {
        return Math.min(position.index, blocks.length)
      }
      return blocks.length
    }

    switch (operation.op) {
      case 'insert': {
        if (typeof operation.block.blockType !== 'string') {
          issues.push(`${label}: "block.blockType" is required`)
          return
        }
        const position = resolvePosition(operation)
        if (typeof position === 'string') {
          issues.push(position)
          return
        }
        const { id: _ignoredId, ...block } = operation.block
        blocks.splice(position, 0, block)
        break
      }
      case 'move': {
        const from = findIndex(operation.blockId)
        if (from < 0) {
          issues.push(notFound(operation.blockId))
          return
        }
        if (operation.after === undefined && operation.before === undefined && operation.index === undefined) {
          issues.push(`${label}: give "after", "before" or "index" to say where the block goes`)
          return
        }
        const [moved] = blocks.splice(from, 1)
        const position = resolvePosition(operation)
        if (typeof position === 'string') {
          issues.push(position)
          return
        }
        blocks.splice(position, 0, moved)
        break
      }
      case 'remove': {
        const at = findIndex(operation.blockId)
        if (at < 0) {
          issues.push(notFound(operation.blockId))
          return
        }
        blocks.splice(at, 1)
        if (!removedIds.has(path)) {
          removedIds.set(path, new Set())
        }
        removedIds.get(path)!.add(operation.blockId)
        break
      }
      case 'update': {
        const at = findIndex(operation.blockId)
        if (at < 0) {
          issues.push(notFound(operation.blockId))
          return
        }
        const { id: _ignoredId, blockType, ...changes } = operation.data
        if (blockType !== undefined && blockType !== blocks[at].blockType) {
          issues.push(
            `${label}: can't change a block's type (${show(blocks[at].blockType)} → ${show(blockType)}) — remove it and insert a new block instead`,
          )
          return
        }
        blocks[at] = { ...blocks[at], ...changes }
        break
      }
    }

    setAtPath(data, path, blocks)
    touchedPaths.add(path)
  })

  return { data, issues, removedIds, touchedPaths }
}
