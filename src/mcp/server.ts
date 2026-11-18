import type { McpRequestContext, ServerContext, ToolAnnotations } from '@modelcontextprotocol/server'
import type { Payload, TypedUser } from 'payload'

import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import type { PayloadAiConductorConfig } from '../index.js'
import type { ApplyResult, ProposalArgs, ProposalContext, ValidationResult } from '../tools/proposal.js'

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

const userFromContext = (ctx: ServerContext): TypedUser | undefined => {
  return ctx.http?.authInfo?.extra?.user as TypedUser | undefined
}

const toolResult = (data: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  isError,
  structuredContent:
    typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined,
})

const notAvailable = (collection: string) => toolResult({ error: `Collection "${collection}" is not available.` }, true)

type ProposalTool = (payload: Payload, args: ProposalArgs, context: ProposalContext) => Promise<ApplyResult | ValidationResult>

export const buildMcpServer = (
  payload: Payload,
  options: PayloadAiConductorConfig,
): ((ctx: McpRequestContext) => Promise<McpServer>) => {
  const metadataOptions = { blockDocs: options.blockDocs, blocksDir: options.blocksDir }

  return async () => {
    const settings = await getSettings(payload)
    const allowedCollections = discoverCollections(payload.config, resolveAllowedCollections(options, settings))

    const server = new McpServer({ name: 'ai-conductor', version: '1.0.0' })

    server.registerTool(
      'list_collections',
      {
        annotations: { readOnlyHint: true },
        description: TOOL_DESCRIPTIONS.list_collections,
      },
      () => {
        const collections = allowedCollections.map((slug) => ({
          blocksFields: findBlocksFields(payload.collections[slug].config.fields).map((field) => field.name),
          collection: slug,
        }))
        return toolResult({ collections })
      },
    )

    server.registerTool(
      'get_collection_schema',
      {
        annotations: { readOnlyHint: true },
        description: TOOL_DESCRIPTIONS.get_collection_schema,
        inputSchema: z.object({ collection: z.string() }),
      },
      ({ collection }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        return toolResult(describeCollection(payload.collections[asCollectionSlug(collection)].config))
      },
    )

    server.registerTool(
      'list_blocks',
      {
        annotations: { readOnlyHint: true },
        description: TOOL_DESCRIPTIONS.list_blocks,
        inputSchema: z.object({ collection: z.string(), field: z.string().optional() }),
      },
      ({ collection, field }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }

        const blocksFields = findBlocksFields(payload.collections[asCollectionSlug(collection)].config.fields).filter(
          (blocksField) => !field || blocksField.name === field,
        )

        return toolResult({
          fields: blocksFields.map((blocksField) => ({
            blocks: blocksField.blocks.map((block) => ({
              slug: block.slug,
              ...resolveBlockMetadata(block, metadataOptions),
            })),
            field: blocksField.name,
          })),
        })
      },
    )

    server.registerTool(
      'get_block_schema',
      {
        annotations: { readOnlyHint: true },
        description: TOOL_DESCRIPTIONS.get_block_schema,
        inputSchema: z.object({ slug: z.string(), collection: z.string(), field: z.string().optional() }),
      },
      ({ slug, collection, field }) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }

        const blocksFields = findBlocksFields(payload.collections[asCollectionSlug(collection)].config.fields).filter(
          (blocksField) => !field || blocksField.name === field,
        )

        for (const blocksField of blocksFields) {
          const block = blocksField.blocks.find((b) => b.slug === slug)
          if (block) {
            return toolResult({
              ...describeBlock(block, 0),
              metadata: resolveBlockMetadata(block, metadataOptions),
            })
          }
        }

        return toolResult({ error: `Block "${slug}" was not found.` }, true)
      },
    )

    server.registerTool(
      'search_documents',
      {
        annotations: { readOnlyHint: true },
        description: TOOL_DESCRIPTIONS.search_documents,
        inputSchema: z.object(searchDocumentsInputShape),
      },
      async ({ collection, limit, query }, ctx) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }

        const results = await searchDocuments(
          payload,
          { collection, limit, query },
          { user: userFromContext(ctx) },
        )
        return toolResult({ results })
      },
    )

    server.registerTool(
      'get_document',
      {
        annotations: { readOnlyHint: true },
        description: TOOL_DESCRIPTIONS.get_document,
        inputSchema: z.object({ ...getDocumentInputShape, locale: z.string().optional() }),
      },
      async ({ id, collection, locale }, ctx) => {
        if (!isCollectionAllowed(collection, allowedCollections)) {
          return notAvailable(collection)
        }
        const result = await getDocument(payload, { id, collection }, { locale, user: userFromContext(ctx) })
        return toolResult(result, 'error' in result)
      },
    )

    const proposalInputSchema = z.object({ ...proposalInputShape, locale: z.string().optional() })

    const registerProposalTool = (
      name: 'apply_proposal' | 'propose_layout' | 'revise_proposal',
      tool: ProposalTool,
      annotations: ToolAnnotations,
    ) => {
      server.registerTool(
        name,
        { annotations, description: TOOL_DESCRIPTIONS[name], inputSchema: proposalInputSchema },
        async (args, ctx) => {
          if (!isCollectionAllowed(args.collection, allowedCollections)) {
            return notAvailable(args.collection)
          }

          const user = userFromContext(ctx)
          const result = await tool(
            payload,
            { data: args.data, operations: args.operations, target: { id: args.id, collection: args.collection } },
            { locale: args.locale, user },
          )

          if (name === 'apply_proposal' && 'success' in result && result.success) {
            const docId = (result.doc as { id: number | string }).id
            await recordAppliedProposal(payload, { collection: args.collection, docId }, { source: 'mcp', user })
          }

          const isError = 'valid' in result ? !result.valid : !result.success
          return toolResult(result, isError)
        },
      )
    }

    registerProposalTool('propose_layout', proposeLayout, { readOnlyHint: true })
    registerProposalTool('revise_proposal', reviseProposal, { readOnlyHint: true })
    registerProposalTool('apply_proposal', applyProposal, {
      destructiveHint: true,
      idempotentHint: false,
      readOnlyHint: false,
    })

    return server
  }
}
