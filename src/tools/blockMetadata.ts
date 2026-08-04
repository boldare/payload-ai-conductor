import type { Block } from 'payload'

import fs from 'fs'
import matter from 'gray-matter'

export type BlockDocsOption = Array<{ path: string; slug: string }>

export type BlockMetadata = {
  description?: string
  examples?: unknown[]
  source: 'custom' | 'markdown' | 'none'
}

type AiConductorBlockCustom = {
  description?: string
  examples?: unknown[]
}

const readMarkdownDoc = (filePath: string): { description?: string; examples?: unknown[] } | null => {
  if (!fs.existsSync(filePath)) {
    return null
  }

  const { content, data } = matter(fs.readFileSync(filePath, 'utf8'))
  const body = content.trim()

  return {
    description: typeof data.description === 'string' ? data.description : body || undefined,
    examples: Array.isArray(data.examples) ? data.examples : undefined,
  }
}

const resolveMarkdownPath = (slug: string, blockDocs?: BlockDocsOption, blocksDir?: string): string | undefined => {
  const explicit = blockDocs?.find((doc) => doc.slug === slug)
  if (explicit) {
    return explicit.path
  }

  if (blocksDir) {
    return `${blocksDir}/${slug}.md`
  }

  return undefined
}

export const resolveBlockMetadata = (
  block: Block,
  options: { blockDocs?: BlockDocsOption; blocksDir?: string } = {},
): BlockMetadata => {
  const custom = block.custom?.aiConductor as AiConductorBlockCustom | undefined
  if (custom?.description) {
    return {
      description: custom.description,
      examples: Array.isArray(custom.examples) ? custom.examples : undefined,
      source: 'custom',
    }
  }

  const mdPath = resolveMarkdownPath(block.slug, options.blockDocs, options.blocksDir)
  const doc = mdPath ? readMarkdownDoc(mdPath) : null
  if (doc && (doc.description || doc.examples)) {
    return { ...doc, source: 'markdown' }
  }

  return { source: 'none' }
}
