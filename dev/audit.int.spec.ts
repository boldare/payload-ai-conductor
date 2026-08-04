import type { Payload, TypedUser } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { CONVERSATIONS_COLLECTION_SLUG } from '../src/collections/conversations.js'
import { recordAppliedProposal, recordConversationMessages } from '../src/tools/audit.js'
import { devUser } from './helpers/credentials.js'

let payload: Payload
let user: TypedUser

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'users', where: { email: { equals: devUser.email } } })
  user = docs[0] as TypedUser
})

describe('recordAppliedProposal', () => {
  test('creates a new conversation record for an mcp apply_proposal call', async () => {
    await recordAppliedProposal(payload, { collection: 'pages', docId: 42 }, { source: 'mcp', user })

    const { docs } = await payload.find({
      collection: CONVERSATIONS_COLLECTION_SLUG,
      overrideAccess: true,
      where: { source: { equals: 'mcp' } },
    })

    expect(docs.some((doc) => (doc.appliedProposals as unknown[])?.length > 0)).toBe(true)
  })

  test('appends to the existing conversation record when a conversationId is reused', async () => {
    const conversationId = 'conversation-append-test'

    await recordAppliedProposal(payload, { collection: 'pages', docId: 1 }, { conversationId, source: 'chat', user })
    await recordAppliedProposal(payload, { collection: 'pages', docId: 2 }, { conversationId, source: 'chat', user })

    const { docs } = await payload.find({
      collection: CONVERSATIONS_COLLECTION_SLUG,
      overrideAccess: true,
      where: { conversationId: { equals: conversationId } },
    })

    expect(docs).toHaveLength(1)
    expect(docs[0].appliedProposals).toHaveLength(2)
  })

  test('does nothing for an unauthenticated caller', async () => {
    const before = await payload.count({ collection: CONVERSATIONS_COLLECTION_SLUG, overrideAccess: true })
    await recordAppliedProposal(payload, { collection: 'pages', docId: 1 }, { source: 'mcp' })
    const after = await payload.count({ collection: CONVERSATIONS_COLLECTION_SLUG, overrideAccess: true })

    expect(after.totalDocs).toBe(before.totalDocs)
  })
})

describe('recordConversationMessages', () => {
  test('creates then updates the same conversation record for a given conversationId', async () => {
    const conversationId = 'conversation-messages-test'

    await recordConversationMessages(payload, [{ role: 'user', text: 'hello' }], { conversationId, user })
    await recordConversationMessages(payload, [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi' }], {
      conversationId,
      user,
    })

    const { docs } = await payload.find({
      collection: CONVERSATIONS_COLLECTION_SLUG,
      overrideAccess: true,
      where: { conversationId: { equals: conversationId } },
    })

    expect(docs).toHaveLength(1)
    expect(docs[0].messages).toHaveLength(2)
  })
})
