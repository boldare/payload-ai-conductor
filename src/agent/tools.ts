import type { ToolSet } from 'ai'
import type { Payload, TypedUser } from 'payload'

import { tool } from 'ai'
import { z } from 'zod'

import type { PayloadAiConductorConfig } from '../index.js'

import { getSettings, resolveAllowedCollections } from '../globals/settings.js'
import { recordAppliedProposal } from '../tools/audit.js'
import { resolveBlockMetadata } from '../tools/blockMetadata.js'
import { searchDocuments } from '../tools/lookup.js'
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

  const proposalInputSchema = z.object({
    id: z.union([z.string(), z.number()]).optional(),
    collection: z.string(),
    data: z.record(z.string(), z.unknown()),
  })

  return {
    apply_proposal: tool({
      description: 'Validate and write a proposal to the database. Requires explicit user approval before it runs.',
      execute: async ({ id, collection, data }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        const result = await applyProposal(payload, { data, target: { id, collection } }, context)
        if (result.success) {
          const docId = (result.doc as { id: number | string }).id
          await recordAppliedProposal(payload, { collection, docId }, { ...context, source: 'chat' })
        }
        return result
      },
      inputSchema: proposalInputSchema,
    }),
    get_block_schema: tool({
      description: 'Get the field schema and usage guidance for one block, by slug.',
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
      description: "Get a collection's full field schema, including nested blocks fields.",
      execute: ({ collection }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        return describeCollection(payload.collections[asCollectionSlug(collection)].config)
      },
      inputSchema: z.object({ collection: z.string() }),
    }),
    list_blocks: tool({
      description: 'List the blocks available on a collection, with AI Conductor usage guidance for each.',
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
      description: 'List the collections AI Conductor can read/write, with the name of each blocks-type field.',
      execute: () => ({
        collections: allowedCollections.map((slug) => ({
          blocksFields: findBlocksFields(payload.collections[slug].config.fields).map((field) => field.name),
          collection: slug,
        })),
      }),
      inputSchema: z.object({}),
    }),
    propose_layout: tool({
      description: 'Validate a proposed document layout/content without writing it. Returns validation issues if invalid.',
      execute: async ({ id, collection, data }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        return proposeLayout(payload, { data, target: { id, collection } }, context)
      },
      inputSchema: proposalInputSchema,
    }),
    revise_proposal: tool({
      description: 'Re-validate a revised version of a pending proposal, before it is applied.',
      execute: async ({ id, collection, data }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        return reviseProposal(payload, { data, target: { id, collection } }, context)
      },
      inputSchema: proposalInputSchema,
    }),
    search_documents: tool({
      description: 'Search a collection for existing documents, e.g. to find a document to reference by ID.',
      execute: async ({ collection, limit, query }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        const results = await searchDocuments(payload, { collection, limit, query }, context)
        return { results }
      },
      inputSchema: z.object({ collection: z.string(), limit: z.number().optional(), query: z.string().optional() }),
    }),
  }
}
