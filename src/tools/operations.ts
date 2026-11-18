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

export type BlockChange = {
  blockType: string
  /** Fields whose value differs from the stored block (updates only). */
  changedFields?: string[]
  id?: string
  label?: string
  /** True when a kept block ends up in a different position relative to the other kept blocks. */
  moved?: boolean
  status: 'added' | 'unchanged' | 'updated'
}

export type ChangeSummary = {
  blocks: Array<{
    field: string
    items: BlockChange[]
    removed: Array<Pick<BlockChange, 'blockType' | 'id' | 'label'>>
  }>
  fields: Array<{ after: unknown; before?: unknown; field: string }>
  mode: 'create' | 'update'
}

const lexicalText = (node: unknown): string => {
  if (typeof node !== 'object' || node === null) {
    return ''
  }
  const record = node as { children?: unknown[]; text?: unknown }
  const own = typeof record.text === 'string' ? record.text : ''
  const children = Array.isArray(record.children) ? record.children.map(lexicalText).filter(Boolean).join(' ') : ''
  return [own, children].filter(Boolean).join(' ')
}

/** A compact, JSON-friendly preview of a field value for change summaries. */
export const previewValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return truncate(value, 120)
  }
  if (Array.isArray(value)) {
    return `[${value.length} item${value.length === 1 ? '' : 's'}]`
  }
  if (typeof value === 'object' && value !== null) {
    if ('root' in value) {
      return truncate(lexicalText((value as { root: unknown }).root) || '(rich text)', 120)
    }
    return '{…}'
  }
  return value
}

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

const stableJson = (value: unknown): string => JSON.stringify(value ?? null)

const toBlockChange = (block: BlockData, status: BlockChange['status']): BlockChange => ({
  id: idOf(block.id),
  blockType: show(block.blockType),
  label: blockLabel(block),
  status,
})

/** What a proposal would change, block by block — shown to the model and on the approval card. */
export const describeChanges = (
  before: null | Record<string, unknown>,
  after: Record<string, unknown>,
  blocksFieldPaths: string[],
): ChangeSummary => {
  // Blocks get their own per-block summary below, so blank them out of the plain field comparison.
  const withoutBlocks = (data: Record<string, unknown>) => {
    const copy = structuredClone(data)
    for (const path of blocksFieldPaths) {
      setAtPath(copy, path, undefined)
    }
    return copy
  }
  const beforeRest = before ? withoutBlocks(before) : {}
  const afterRest = withoutBlocks(after)

  const fields: ChangeSummary['fields'] = []
  for (const key of new Set([...Object.keys(afterRest), ...Object.keys(beforeRest)])) {
    const prev = beforeRest[key]
    const next = afterRest[key]
    if (before ? stableJson(prev) === stableJson(next) : isEmpty(next)) {
      continue
    }
    fields.push(before ? { after: previewValue(next), before: previewValue(prev), field: key } : { after: previewValue(next), field: key })
  }

  const blocks: ChangeSummary['blocks'] = blocksFieldPaths
    .map((path) => {
      const prevBlocks = before ? blocksAt(before, path) : []
      const nextBlocks = blocksAt(after, path)
      const prevById = new Map(
        prevBlocks.flatMap((b): Array<[string, BlockData]> => {
          const id = idOf(b.id)
          return id ? [[id, b]] : []
        }),
      )
      const nextIds = new Set(blockIds(nextBlocks))
      const keptBefore = blockIds(prevBlocks).filter((id) => nextIds.has(id))
      const keptAfter = blockIds(nextBlocks).filter((id) => prevById.has(id))

      const items = nextBlocks.map((block): BlockChange => {
        const id = idOf(block.id)
        const prev = id ? prevById.get(id) : undefined
        if (!id || !prev) {
          return toBlockChange(block, 'added')
        }
        const changedFields = [...new Set([...Object.keys(block), ...Object.keys(prev)])].filter(
          (key) => key !== 'id' && stableJson(prev[key]) !== stableJson(block[key]),
        )
        const moved = keptBefore.indexOf(id) !== keptAfter.indexOf(id)
        return {
          ...toBlockChange(block, changedFields.length > 0 ? 'updated' : 'unchanged'),
          ...(changedFields.length > 0 && { changedFields }),
          ...(moved && { moved }),
        }
      })
      const removed = prevBlocks
        .filter((block) => {
          const id = idOf(block.id)
          return id !== undefined && !nextIds.has(id)
        })
        .map((block) => {
          const { id, blockType, label } = toBlockChange(block, 'unchanged')
          return { id, blockType, label }
        })

      return { field: path, items, removed }
    })
    .filter((entry) => entry.items.length > 0 || entry.removed.length > 0)

  return { blocks, fields, mode: before ? 'update' : 'create' }
}
