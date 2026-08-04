import type { Payload, TypedUser } from 'payload'

import { asCollectionSlug, asLocale } from './schema.js'
import { buildFieldsSchema, collectFieldsRefs } from './validate.js'

export type ProposalContext = { locale?: string; user?: TypedUser }

export type ProposalTarget = { collection: string; id?: number | string }

export type ProposalArgs = { data: Record<string, unknown>; target: ProposalTarget }

export type ValidationResult = { issues: string[]; valid: false } | { valid: true }

export type ApplyResult = { doc: unknown; success: true } | { issues: string[]; success: false }

const supportsDrafts = (payload: Payload, collection: string): boolean => {
  const versions = payload.collections[asCollectionSlug(collection)]?.config.versions
  return typeof versions === 'object' && Boolean(versions.drafts)
}

export const validateProposal = async (
  payload: Payload,
  args: ProposalArgs,
  context: ProposalContext = {},
): Promise<ValidationResult> => {
  const collection = payload.collections[asCollectionSlug(args.target.collection)]
  if (!collection) {
    return { issues: [`Unknown collection "${args.target.collection}"`], valid: false }
  }

  const schema = buildFieldsSchema(collection.config.fields).partial()
  const result = schema.safeParse(args.data)
  if (!result.success) {
    return {
      issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      valid: false,
    }
  }

  const refs = collectFieldsRefs(collection.config.fields, args.data)
  const issues: string[] = []

  await Promise.all(
    refs.map(async (ref) => {
      try {
        await payload.findByID({
          id: ref.id,
          collection: asCollectionSlug(ref.collection),
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
    return { issues, valid: false }
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
  const validation = await validateProposal(payload, args, context)
  if (!validation.valid) {
    return { issues: validation.issues, success: false }
  }

  const draft = supportsDrafts(payload, args.target.collection)
  const collection = asCollectionSlug(args.target.collection)
  const locale = asLocale(context.locale)

  try {
    const doc = args.target.id
      ? await payload.update({
          id: args.target.id,
          collection,
          data: args.data,
          draft,
          locale,
          overrideAccess: false,
          user: context.user,
        })
      : await payload.create({
          collection,
          data: args.data,
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
