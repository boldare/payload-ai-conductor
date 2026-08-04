import type { Payload, TypedUser } from 'payload'

import { CONVERSATIONS_COLLECTION_SLUG } from '../collections/conversations.js'

export type AuditContext = { conversationId?: string; source: 'chat' | 'mcp'; user?: TypedUser }

type AppliedProposalEntry = { appliedAt: string; collection: string; docId: string }

const findConversation = async (payload: Payload, conversationId: string, user: TypedUser) => {
  const { docs } = await payload.find({
    collection: CONVERSATIONS_COLLECTION_SLUG,
    limit: 1,
    overrideAccess: true,
    where: { conversationId: { equals: conversationId }, user: { equals: user.id } },
  })
  return docs[0]
}

export const recordAppliedProposal = async (
  payload: Payload,
  proposal: { collection: string; docId: number | string },
  context: AuditContext,
): Promise<void> => {
  if (!context.user) {
    return
  }

  const entry: AppliedProposalEntry = {
    appliedAt: new Date().toISOString(),
    collection: proposal.collection,
    docId: String(proposal.docId),
  }
  const existing = context.conversationId && (await findConversation(payload, context.conversationId, context.user))

  if (existing) {
    const appliedProposals = (existing.appliedProposals as AppliedProposalEntry[] | undefined) ?? []
    await payload.update({
      id: existing.id,
      collection: CONVERSATIONS_COLLECTION_SLUG,
      data: { appliedProposals: [...appliedProposals, entry] },
      overrideAccess: true,
    })
    return
  }

  await payload.create({
    collection: CONVERSATIONS_COLLECTION_SLUG,
    data: {
      appliedProposals: [entry],
      conversationId: context.conversationId,
      source: context.source,
      user: context.user.id,
    },
    overrideAccess: true,
  })
}

export const recordConversationMessages = async (
  payload: Payload,
  messages: unknown[],
  context: { conversationId: string; user: TypedUser },
): Promise<void> => {
  const existing = await findConversation(payload, context.conversationId, context.user)

  if (existing) {
    await payload.update({
      id: existing.id,
      collection: CONVERSATIONS_COLLECTION_SLUG,
      data: { messages },
      overrideAccess: true,
    })
    return
  }

  await payload.create({
    collection: CONVERSATIONS_COLLECTION_SLUG,
    data: { conversationId: context.conversationId, messages, source: 'chat', user: context.user.id },
    overrideAccess: true,
  })
}
