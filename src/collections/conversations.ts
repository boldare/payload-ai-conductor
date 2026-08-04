import type { CollectionConfig } from 'payload'

import { asCollectionSlug } from '../tools/schema.js'

export const CONVERSATIONS_COLLECTION_SLUG = 'ai-conductor-conversations'

export const buildConversationsCollection = (usersSlug: string): CollectionConfig => ({
  slug: CONVERSATIONS_COLLECTION_SLUG,
  access: {
    create: () => false,
    delete: ({ req }) => Boolean(req.user),
    read: ({ req }) => (req.user ? { user: { equals: req.user.id } } : false),
    update: () => false,
  },
  admin: {
    defaultColumns: ['user', 'source', 'updatedAt'],
    description: 'Audit trail of AI Conductor conversations and the proposals they applied. Written by the plugin only.',
    useAsTitle: 'source',
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: asCollectionSlug(usersSlug), required: true },
    {
      name: 'source',
      type: 'select',
      options: [
        { label: 'Embedded chat', value: 'chat' },
        { label: 'MCP', value: 'mcp' },
      ],
      required: true,
    },
    {
      name: 'conversationId',
      type: 'text',
      admin: { description: 'The chat session id, for embedded-chat conversations. Unset for MCP tool calls.' },
      index: true,
    },
    { name: 'messages', type: 'json' },
    {
      name: 'appliedProposals',
      type: 'array',
      fields: [
        { name: 'collection', type: 'text', required: true },
        { name: 'docId', type: 'text', required: true },
        { name: 'appliedAt', type: 'date', required: true },
      ],
    },
  ],
})
