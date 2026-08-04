import type { Block, CollectionConfig, Config, Field } from 'payload'

import { describe, expect, test } from 'vitest'

import { describeBlock, describeCollection, describeFields, discoverCollections, hasBlocksField } from './schema.js'

describe('describeFields', () => {
  test('describes simple field types', () => {
    const fields: Field[] = [
      { name: 'title', type: 'text', required: true },
      { name: 'summary', type: 'textarea', localized: true },
    ]

    expect(describeFields(fields)).toEqual([
      { name: 'title', type: 'text', localized: undefined, required: true },
      { name: 'summary', type: 'textarea', localized: true, required: undefined },
    ])
  })

  test('flattens row and collapsible wrapper fields', () => {
    const fields: Field[] = [
      {
        type: 'row',
        fields: [{ name: 'a', type: 'text' }, { name: 'b', type: 'text' }],
      },
      {
        type: 'collapsible',
        fields: [{ name: 'c', type: 'text' }],
        label: 'More',
      },
    ]

    expect(describeFields(fields).map((f) => f.name)).toEqual(['a', 'b', 'c'])
  })

  test('flattens unnamed tabs but nests named tabs as a group', () => {
    const fields: Field[] = [
      {
        type: 'tabs',
        tabs: [
          { fields: [{ name: 'unnamedField', type: 'text' }], label: 'Unnamed' },
          { name: 'meta', fields: [{ name: 'namedField', type: 'text' }], label: 'Named' },
        ],
      },
    ]

    const result = describeFields(fields)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'unnamedField' })
    expect(result[1]).toMatchObject({ name: 'meta', type: 'group' })
    expect(result[1].fields).toEqual([{ name: 'namedField', type: 'text', localized: undefined, required: undefined }])
  })

  test('describes select options and relationship/upload targets', () => {
    const fields: Field[] = [
      {
        name: 'style',
        type: 'select',
        options: ['primary', { label: 'Secondary', value: 'secondary' }],
      },
      { name: 'author', type: 'relationship', relationTo: 'users' },
      { name: 'image', type: 'upload', hasMany: true, relationTo: ['media', 'users'] },
    ]

    const result = describeFields(fields)
    expect(result[0]).toMatchObject({ options: ['primary', 'secondary'] })
    expect(result[1]).toMatchObject({ relationTo: 'users' })
    expect(result[2]).toMatchObject({ hasMany: true, relationTo: ['media', 'users'] })
  })

  test('drops ui fields, which are presentational only', () => {
    const fields: Field[] = [{ name: 'note', type: 'ui' } as unknown as Field]
    expect(describeFields(fields)).toEqual([])
  })

  test('recurses into array and group fields', () => {
    const fields: Field[] = [
      {
        name: 'items',
        type: 'array',
        fields: [{ name: 'label', type: 'text' }],
      },
      {
        name: 'seo',
        type: 'group',
        fields: [{ name: 'metaTitle', type: 'text' }],
      },
    ]

    const result = describeFields(fields)
    expect(result[0].fields).toEqual([
      { name: 'label', type: 'text', localized: undefined, required: undefined },
    ])
    expect(result[1].fields).toEqual([
      { name: 'metaTitle', type: 'text', localized: undefined, required: undefined },
    ])
  })
})

describe('describeBlock / blocks fields', () => {
  const leafBlock: Block = {
    slug: 'leaf',
    fields: [{ name: 'text', type: 'text' }],
  }

  test('describes a blocks field and its block options', () => {
    const fields: Field[] = [{ name: 'layout', type: 'blocks', blocks: [leafBlock] }]
    const result = describeFields(fields)
    expect(result[0].blocks).toEqual([{ slug: 'leaf', fields: [{ name: 'text', type: 'text', localized: undefined, required: undefined }] }])
  })

  test('truncates recursive nested blocks beyond maxDepth instead of recursing forever', () => {
    const selfNesting: Block = {
      slug: 'recursive',
      fields: [],
    }
    // a block whose own fields contain a blocks field referencing itself
    selfNesting.fields = [{ name: 'children', type: 'blocks', blocks: [selfNesting] }]

    const result = describeBlock(selfNesting, 0, 2)
    expect(result.truncated).toBeFalsy()
    const nested = result.fields[0].blocks?.[0]
    expect(nested?.slug).toBe('recursive')
    // depth guard should kick in at some level and mark truncated without throwing
    let current = nested
    let guard = 0
    while (current && !current.truncated && guard < 10) {
      current = current.fields[0]?.blocks?.[0]
      guard += 1
    }
    expect(current?.truncated).toBe(true)
  })
})

describe('hasBlocksField / discoverCollections', () => {
  const withBlocks: CollectionConfig = {
    slug: 'pages',
    fields: [{ name: 'layout', type: 'blocks', blocks: [] }],
  }
  const withoutBlocks: CollectionConfig = {
    slug: 'settings',
    fields: [{ name: 'title', type: 'text' }],
  }
  const nestedBlocks: CollectionConfig = {
    slug: 'posts',
    fields: [
      {
        type: 'tabs',
        tabs: [{ fields: [{ name: 'layout', type: 'blocks', blocks: [] }], label: 'Content' }],
      },
    ],
  }

  test('detects a top-level blocks field', () => {
    expect(hasBlocksField(withBlocks.fields)).toBe(true)
    expect(hasBlocksField(withoutBlocks.fields)).toBe(false)
  })

  test('detects a blocks field nested inside tabs', () => {
    expect(hasBlocksField(nestedBlocks.fields)).toBe(true)
  })

  test('discovers only collections with a blocks field', () => {
    const config: Config = { collections: [withBlocks, withoutBlocks, nestedBlocks] } as Config
    expect(discoverCollections(config).sort()).toEqual(['pages', 'posts'])
  })

  test('intersects discovery with an allow-list', () => {
    const config: Config = { collections: [withBlocks, withoutBlocks, nestedBlocks] } as Config
    expect(discoverCollections(config, ['pages'])).toEqual(['pages'])
  })
})

test('describeCollection describes a full collection', () => {
  const collection: CollectionConfig = {
    slug: 'pages',
    fields: [{ name: 'title', type: 'text', required: true }],
  }

  expect(describeCollection(collection)).toEqual({
    slug: 'pages',
    fields: [{ name: 'title', type: 'text', localized: undefined, required: true }],
  })
})
