import type { ToolSet } from 'ai'
import type { Payload, TypedUser } from 'payload'

import { tool } from 'ai'
import { z } from 'zod'

import type { PayloadAiConductorConfig } from '../index.js'

import { getSettings, resolveAllowedCollections } from '../globals/settings.js'
import { recordAppliedProposal } from '../tools/audit.js'
import { resolveBlockMetadata } from '../tools/blockMetadata.js'
import {
  getDocumentInputShape,
  proposalInputShape,
  searchDocumentsInputShape,
  TOOL_DESCRIPTIONS,
} from '../tools/definitions.js'
import { getDocument, searchDocuments } from '../tools/lookup.js'
import { applyProposal, proposeLayout, reviseProposal } from '../tools/proposal.js'
import {
  asCollectionSlug,
  describeBlock,
  describeCollection,
  discoverCollections,
  findBlocksFields,
  isCollectionAllowed,
} from '../tools/schema.js'

export type AgentContext = { conversationId?: string; locale?: string; user?: TypedUser }

const notAvailable = (collection: string) => ({ error: `Collection "${collection}" is not available.` })

export const buildAgentTools = async (
  payload: Payload,
  options: PayloadAiConductorConfig,
  context: AgentContext,
): Promise<ToolSet> => {
  const settings = await getSettings(payload)
  const allowedCollections = discoverCollections(payload.config, resolveAllowedCollections(options, settings))
  const metadataOptions = { blockDocs: options.blockDocs, blocksDir: options.blocksDir }

  const proposalInputSchema = z.object(proposalInputShape)

  return {
    apply_proposal: tool({
      description: `${TOOL_DESCRIPTIONS.apply_proposal} Requires the user's approval in the chat UI before it runs.`,
      execute: async ({ id, collection, data, operations }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        const result = await applyProposal(payload, { data, operations, target: { id, collection } }, context)
        if (result.success) {
          const docId = (result.doc as { id: number | string }).id
          await recordAppliedProposal(payload, { collection, docId }, { ...context, source: 'chat' })
        }
        return result
      },
      inputSchema: proposalInputSchema,
    }),
    get_block_schema: tool({
      description: TOOL_DESCRIPTIONS.get_block_schema,
      execute: ({ slug, collection, field }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }

        const blocksFields = findBlocksFields(payload.collections[asCollectionSlug(collection)].config.fields).filter(
          (blocksField) => !field || blocksField.name === field,
        )

        for (const blocksField of blocksFields) {
          const block = blocksField.blocks.find((b) => b.slug === slug)
          if (block) {
            return { ...describeBlock(block, 0), metadata: resolveBlockMetadata(block, metadataOptions) }
          }
        }

        return { error: `Block "${slug}" was not found.` }
      },
      inputSchema: z.object({ slug: z.string(), collection: z.string(), field: z.string().optional() }),
    }),
    get_collection_schema: tool({
      description: TOOL_DESCRIPTIONS.get_collection_schema,
      execute: ({ collection }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        return describeCollection(payload.collections[asCollectionSlug(collection)].config)
      },
      inputSchema: z.object({ collection: z.string() }),
    }),
    get_document: tool({
      description: TOOL_DESCRIPTIONS.get_document,
      execute: async ({ id, collection }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        return getDocument(payload, { id, collection }, context)
      },
      inputSchema: z.object(getDocumentInputShape),
    }),
    list_blocks: tool({
      description: TOOL_DESCRIPTIONS.list_blocks,
      execute: ({ collection, field }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }

        const blocksFields = findBlocksFields(payload.collections[asCollectionSlug(collection)].config.fields).filter(
          (blocksField) => !field || blocksField.name === field,
        )

        return {
          fields: blocksFields.map((blocksField) => ({
            blocks: blocksField.blocks.map((block) => ({
              slug: block.slug,
              ...resolveBlockMetadata(block, metadataOptions),
            })),
            field: blocksField.name,
          })),
        }
      },
      inputSchema: z.object({ collection: z.string(), field: z.string().optional() }),
    }),
    list_collections: tool({
      description: TOOL_DESCRIPTIONS.list_collections,
      execute: () => ({
        collections: allowedCollections.map((slug) => ({
          blocksFields: findBlocksFields(payload.collections[slug].config.fields).map((field) => field.name),
          collection: slug,
        })),
      }),
      inputSchema: z.object({}),
    }),
    propose_layout: tool({
      description: TOOL_DESCRIPTIONS.propose_layout,
      execute: async ({ id, collection, data, operations }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        return proposeLayout(payload, { data, operations, target: { id, collection } }, context)
      },
      inputSchema: proposalInputSchema,
    }),
    revise_proposal: tool({
      description: TOOL_DESCRIPTIONS.revise_proposal,
      execute: async ({ id, collection, data, operations }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        return reviseProposal(payload, { data, operations, target: { id, collection } }, context)
      },
      inputSchema: proposalInputSchema,
    }),
    search_documents: tool({
      description: TOOL_DESCRIPTIONS.search_documents,
      execute: async ({ collection, limit, query }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        const results = await searchDocuments(payload, { collection, limit, query }, context)
        return { results }
      },
      inputSchema: z.object(searchDocumentsInputShape),
    }),
  }
}
