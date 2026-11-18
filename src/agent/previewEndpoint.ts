import type { PayloadHandler } from 'payload'

import type { PayloadAiConductorConfig } from '../index.js'
import type { BlockOperation } from '../tools/operations.js'

import { getSettings, resolveAllowedCollections } from '../globals/settings.js'
import { validateProposal } from '../tools/proposal.js'
import { discoverCollections, isCollectionAllowed } from '../tools/schema.js'

type PreviewBody = {
  collection?: unknown
  data?: Record<string, unknown>
  id?: number | string
  operations?: BlockOperation[]
}

/**
 * Backs the approval card: given a pending apply_proposal's input, returns what it would change
 * (create vs update, field before/after, blocks added/updated/moved/removed) by running the exact
 * resolution apply_proposal will run — same access rules, same stored document, same operations —
 * without writing anything.
 */
export const createPreviewEndpointHandler = (options: PayloadAiConductorConfig): PayloadHandler => {
  return async (req) => {
    const { user } = req
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await (req as Request).json()) as PreviewBody
    if (typeof body.collection !== 'string') {
      return Response.json({ error: 'Missing "collection"' }, { status: 400 })
    }

    const settings = await getSettings(req.payload)
    const allowed = discoverCollections(req.payload.config, resolveAllowedCollections(options, settings))
    if (!isCollectionAllowed(body.collection, allowed)) {
      return Response.json({ error: `Collection "${body.collection}" is not available.` }, { status: 400 })
    }

    const result = await validateProposal(
      req.payload,
      { data: body.data, operations: body.operations, target: { id: body.id, collection: body.collection } },
      { locale: req.locale ?? undefined, user },
    )
    return Response.json(result)
  }
}
