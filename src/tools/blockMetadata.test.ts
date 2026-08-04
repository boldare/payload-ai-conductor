import type { Block } from 'payload'

import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'vitest'

import { resolveBlockMetadata } from './blockMetadata.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(dirname, '__fixtures__')

describe('resolveBlockMetadata', () => {
  test('prefers custom.aiConductor when present', () => {
    const block: Block = {
      slug: 'hero',
      custom: { aiConductor: { description: 'A hero banner.', examples: [{ heading: 'Hi' }] } },
      fields: [],
    }

    expect(resolveBlockMetadata(block, { blocksDir: fixturesDir })).toEqual({
      description: 'A hero banner.',
      examples: [{ heading: 'Hi' }],
      source: 'custom',
    })
  })

  test('falls back to a markdown file resolved via blocksDir convention', () => {
    const block: Block = { slug: 'testimonial', fields: [] }

    expect(resolveBlockMetadata(block, { blocksDir: fixturesDir })).toEqual({
      description: 'A single customer quote.',
      examples: [{ authorName: 'Jane Doe', quote: 'Great product.' }],
      source: 'markdown',
    })
  })

  test('uses the markdown body as the description when frontmatter has none', () => {
    const block: Block = { slug: 'bodyOnly', fields: [] }

    const metadata = resolveBlockMetadata(block, { blocksDir: fixturesDir })
    expect(metadata.source).toBe('markdown')
    expect(metadata.description).toBe('Use this block for a simple two-column feature comparison.')
  })

  test('prefers an explicit blockDocs entry over the blocksDir convention', () => {
    const block: Block = { slug: 'testimonial', fields: [] }

    const metadata = resolveBlockMetadata(block, {
      blockDocs: [{ slug: 'testimonial', path: path.join(fixturesDir, 'bodyOnly.md') }],
      blocksDir: fixturesDir,
    })
    expect(metadata.description).toBe('Use this block for a simple two-column feature comparison.')
  })

  test('returns source "none" when nothing is configured', () => {
    const block: Block = { slug: 'untouched', fields: [] }
    expect(resolveBlockMetadata(block)).toEqual({ source: 'none' })
  })

  test('returns source "none" when the markdown file does not exist', () => {
    const block: Block = { slug: 'missing', fields: [] }
    expect(resolveBlockMetadata(block, { blocksDir: fixturesDir })).toEqual({ source: 'none' })
  })
})
