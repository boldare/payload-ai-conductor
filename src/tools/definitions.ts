import { z } from 'zod'

import { blockOperationSchema } from './operations.js'

/**
 * Tool names, descriptions and input shapes shared by the embedded chat agent and the MCP server,
 * so both surfaces describe (and accept) exactly the same contract.
 */

const documentId = z.union([z.string(), z.number()])

export const proposalInputShape = {
  id: documentId.optional().describe('Id of the document to edit. Omit to create a new document.'),
  collection: z.string(),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Create: the whole document. Edit: only the top-level fields to change.'),
  operations: z
    .array(blockOperationSchema)
    .optional()
    .describe('Edit only: block-level changes (update/insert/remove/move) addressed by block id.'),
}

export const getDocumentInputShape = { id: documentId, collection: z.string() }

export const searchDocumentsInputShape = {
  collection: z.string(),
  limit: z.number().optional(),
  query: z.string().optional(),
}

export const TOOL_DESCRIPTIONS = {
  apply_proposal:
    'Write a validated proposal to the database (same arguments as propose_layout). Never call this before the user ' +
    'has explicitly approved the current proposal.',
  get_block_schema: 'Get the field schema and usage guidance for one block, by slug.',
  get_collection_schema: "Get a collection's full field schema, including nested blocks fields.",
  get_document:
    "Read one existing document's current content, including the `id` of every block. Call this before editing a " +
    'document — block operations address blocks by these ids.',
  list_blocks: 'List the blocks available on a collection, with AI Conductor usage guidance for each.',
  list_collections: 'List the collections AI Conductor can read/write, with the name of each blocks-type field.',
  propose_layout:
    'Validate a new document or an edit without writing anything. Create: omit `id`, pass the full document in ' +
    '`data`. Edit: pass `id`, put changed top-level fields in `data`, and use `operations` to update/insert/' +
    'remove/move individual blocks by id (ids come from get_document). A blocks array sent in `data` on an edit ' +
    'replaces the stored one, and is rejected if it would drop blocks it does not mention. Returns `issues` to fix, ' +
    'or `valid: true` with a `changes` summary of exactly what would be written.',
  revise_proposal:
    'Re-validate a revised version of a pending proposal (same arguments as propose_layout), before it is applied.',
  search_documents: 'Search a collection for existing documents, e.g. to find a document to reference or edit by ID.',
} as const
