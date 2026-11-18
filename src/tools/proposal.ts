import type { Payload, TypedUser } from 'payload'

import type { BlockOperation } from './operations.js'

import { applyBlockOperations, blockIds, describeBlock, getAtPath, idOf } from './operations.js'
import { asCollectionSlug, asLocale, contentFields, findBlocksFieldPaths, pickContentData } from './schema.js'
import { collectFieldsRefs, validateFieldsData } from './validate.js'

export type ProposalContext = { locale?: string; user?: TypedUser }

export type ProposalTarget = { collection: string; id?: number | string }

export type ProposalArgs = {
  /** Top-level field values. On create: the whole document. On update: only the fields to change. */
  data?: Record<string, unknown>
  /** Block-level edits (update/insert/remove/move a block by id) — the safe way to edit an existing page. */
  operations?: BlockOperation[]
  target: ProposalTarget
}

export type ValidationResult = { issues: string[]; valid: false } | { valid: true }

export type ApplyResult = { doc: unknown; success: true } | { issues: string[]; success: false }

type ResolvedProposal = {
  /** Exactly what gets passed to payload.create/update. */
  writeData: Record<string, unknown>
}

const supportsDrafts = (payload: Payload, collection: string): boolean => {
  const versions = payload.collections[asCollectionSlug(collection)]?.config.versions
  return typeof versions === 'object' && Boolean(versions.drafts)
}

const refKey = (ref: { collection: string; id: number | string }) => `${ref.collection}:${String(ref.id)}`

/**
 * Turns a proposal into the complete document it would produce — the stored document (on update)
 * plus `data` plus `operations` — and validates *that*, with full `required`/row-limit/unknown-field
 * rules. Validating the merged result is what makes create vs update correct: an update only has to
 * send what changes, but still can't leave the document missing a required field.
 */
const resolveProposal = async (
  payload: Payload,
  args: ProposalArgs,
  context: ProposalContext,
): Promise<{ issues: string[] } | { resolved: ResolvedProposal }> => {
  const collection = payload.collections[asCollectionSlug(args.target.collection)]
  if (!collection) {
    return { issues: [`Unknown collection "${args.target.collection}"`] }
  }

  const fields = contentFields(collection.config.fields)
  const blocksFieldPaths = findBlocksFieldPaths(fields).map((entry) => entry.path)
  const data = args.data ?? {}
  const operations = args.operations ?? []
  const { id } = args.target
  const issues: string[] = []

  let current: null | Record<string, unknown> = null
  if (id !== undefined && id !== null && id !== '') {
    try {
      const doc = await payload.findByID({
        id,
        collection: asCollectionSlug(args.target.collection),
        depth: 0,
        draft: supportsDrafts(payload, args.target.collection),
        locale: asLocale(context.locale),
        overrideAccess: false,
        user: context.user,
      })
      current = pickContentData(fields, doc as unknown as Record<string, unknown>)
    } catch {
      return { issues: [`${args.target.collection}#${String(id)} does not exist or is not accessible`] }
    }
  } else if (operations.some((operation) => operation.op !== 'insert')) {
    return { issues: ['update/remove/move operations edit an existing document — pass its "id"'] }
  }

  for (const operation of operations) {
    const path = operation.field ?? (blocksFieldPaths.length === 1 ? blocksFieldPaths[0] : undefined)
    const topKey = path?.split('.')[0]
    if (topKey && topKey in data) {
      issues.push(`Set either data.${topKey} or operations on "${path}", not both in one proposal`)
    }
  }
  if (issues.length > 0) {
    return { issues }
  }

  const base = current ?? {}
  const applied = applyBlockOperations({ ...base, ...data }, operations, blocksFieldPaths)
  const next = applied.data
  issues.push(...applied.issues)

  // On update, a blocks array in `data` replaces the stored one. Refuse when that would silently
  // drop blocks the proposal never mentioned — the classic "sent one block, lost the other five".
  if (current) {
    for (const path of blocksFieldPaths) {
      const beforeBlocks = (getAtPath(current, path) as Array<Record<string, unknown>> | undefined) ?? []
      const keptIds = new Set(blockIds((getAtPath(next, path) as Array<Record<string, unknown>> | undefined) ?? []))
      const removedOnPurpose = applied.removedIds.get(path) ?? new Set<string>()
      const dropped = beforeBlocks.filter(
        (block) => {
          const blockId = idOf(block.id)
          return blockId !== undefined && !keptIds.has(blockId) && !removedOnPurpose.has(blockId)
        },
      )
      if (dropped.length > 0) {
        issues.push(
          `${path}: this update would delete ${dropped.length} existing block(s) it doesn't mention: ` +
            `${dropped.map(describeBlock).join(', ')}. To change specific blocks use "operations" ` +
            `(update/insert/move by block id); to delete a block on purpose use a "remove" operation; ` +
            `to send a full replacement, include every block you keep with its "id".`,
        )
      }
    }
  }

  issues.push(...validateFieldsData(fields, next))

  // Only references the proposal introduces need checking — the stored ones were valid when saved.
  const existingRefs = new Set(collectFieldsRefs(fields, base).map(refKey))
  const newRefs = collectFieldsRefs(fields, next).filter((ref) => !existingRefs.has(refKey(ref)))
  const uniqueRefs = [...new Map(newRefs.map((ref) => [refKey(ref), ref])).values()]
  await Promise.all(
    uniqueRefs.map(async (ref) => {
      try {
        await payload.findByID({
          id: ref.id,
          collection: asCollectionSlug(ref.collection),
          depth: 0,
          locale: asLocale(context.locale),
          overrideAccess: false,
          user: context.user,
        })
      } catch {
        issues.push(`${ref.collection}:${ref.id} does not exist or is not accessible`)
      }
    }),
  )

  if (issues.length > 0) {
    return { issues }
  }

  const writeKeys = current
    ? new Set([...[...applied.touchedPaths].map((path) => path.split('.')[0]), ...Object.keys(data)])
    : new Set(Object.keys(next))
  const writeData = Object.fromEntries([...writeKeys].map((key) => [key, next[key]]))

  return { resolved: { writeData } }
}

export const validateProposal = async (
  payload: Payload,
  args: ProposalArgs,
  context: ProposalContext = {},
): Promise<ValidationResult> => {
  const result = await resolveProposal(payload, args, context)
  if ('issues' in result) {
    return { issues: result.issues, valid: false }
  }
  return { valid: true }
}

export const proposeLayout = validateProposal
export const reviseProposal = validateProposal

export const applyProposal = async (
  payload: Payload,
  args: ProposalArgs,
  context: ProposalContext = {},
): Promise<ApplyResult> => {
  const result = await resolveProposal(payload, args, context)
  if ('issues' in result) {
    return { issues: result.issues, success: false }
  }

  const { writeData } = result.resolved
  const draft = supportsDrafts(payload, args.target.collection)
  const collection = asCollectionSlug(args.target.collection)
  const locale = asLocale(context.locale)

  try {
    const doc = args.target.id
      ? await payload.update({
          id: args.target.id,
          collection,
          data: writeData,
          draft,
          locale,
          overrideAccess: false,
          user: context.user,
        })
      : await payload.create({
          collection,
          data: writeData,
          draft,
          locale,
          overrideAccess: false,
          user: context.user,
        })

    return { doc, success: true }
  } catch (error) {
    return { issues: [error instanceof Error ? error.message : 'Failed to write proposal'], success: false }
  }
}
