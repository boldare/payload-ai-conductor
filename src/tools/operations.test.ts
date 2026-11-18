import { describe, expect, test } from 'vitest'

import { applyBlockOperations, describeChanges, previewValue } from './operations.js'

const page = () => ({
  layout: [
    { id: 'a', blockType: 'hero', heading: 'Hero' },
    { id: 'b', blockType: 'cta', heading: 'CTA' },
  ],
  title: 'Home',
})

describe('applyBlockOperations', () => {
  test('defaults to the only blocks field and never mutates its input', () => {
    const input = page()
    const result = applyBlockOperations(input, [{ blockId: 'a', data: { heading: 'New' }, op: 'update' }], ['layout'])

    expect(result.issues).toEqual([])
    expect(result.data.layout).toEqual([
      { id: 'a', blockType: 'hero', heading: 'New' },
      { id: 'b', blockType: 'cta', heading: 'CTA' },
    ])
    expect(input.layout[0].heading).toBe('Hero')
    expect([...result.touchedPaths]).toEqual(['layout'])
  })

  test('requires "field" when there are several blocks fields', () => {
    const result = applyBlockOperations(page(), [{ blockId: 'a', op: 'remove' }], ['layout', 'sidebar'])
    expect(result.issues[0]).toContain('"field" is required')
  })

  test('insert supports after/before/index and strips a model-supplied id', () => {
    const result = applyBlockOperations(
      page(),
      [
        { before: 'b', block: { id: 'fake', blockType: 'grid' }, op: 'insert' },
        { block: { blockType: 'richText' }, index: 0, op: 'insert' },
        { block: { blockType: 'testimonial' }, op: 'insert' },
      ],
      ['layout'],
    )

    expect(result.issues).toEqual([])
    expect((result.data.layout as Array<{ blockType: string; id?: string }>).map((b) => b.blockType)).toEqual([
      'richText',
      'hero',
      'grid',
      'cta',
      'testimonial',
    ])
    expect((result.data.layout as Array<{ id?: string }>)[2].id).toBeUndefined()
  })

  test('move without a target and update that changes blockType are refused', () => {
    const result = applyBlockOperations(
      page(),
      [
        { blockId: 'a', op: 'move' },
        { blockId: 'b', data: { blockType: 'hero' }, op: 'update' },
      ],
      ['layout'],
    )
    expect(result.issues).toHaveLength(2)
    expect(result.issues[0]).toContain('"after", "before" or "index"')
    expect(result.issues[1]).toContain("can't change a block's type")
  })

  test('works on nested blocks fields by dotted path', () => {
    const result = applyBlockOperations(
      { hero: { layout: [{ id: 'x', blockType: 'hero' }] } },
      [{ blockId: 'x', field: 'hero.layout', op: 'remove' }],
      ['hero.layout'],
    )
    expect(result.data).toEqual({ hero: { layout: [] } })
    expect(result.removedIds.get('hero.layout')).toEqual(new Set(['x']))
  })
})

describe('describeChanges', () => {
  test('reports added, updated, moved and removed blocks plus changed fields', () => {
    const before = {
      layout: [
        { id: 'a', blockType: 'hero', heading: 'Hero' },
        { id: 'b', blockType: 'cta', heading: 'CTA' },
        { id: 'c', blockType: 'grid', title: 'Grid' },
      ],
      title: 'Home',
    }
    const after = {
      layout: [
        { id: 'b', blockType: 'cta', heading: 'CTA' },
        { blockType: 'testimonial', quote: 'Great' },
        { id: 'a', blockType: 'hero', heading: 'New hero' },
      ],
      title: 'Homepage',
    }

    expect(describeChanges(before, after, ['layout'])).toEqual({
      blocks: [
        {
          field: 'layout',
          items: [
            { id: 'b', blockType: 'cta', label: 'CTA', moved: true, status: 'unchanged' },
            { id: undefined, blockType: 'testimonial', label: 'Great', status: 'added' },
            { id: 'a', blockType: 'hero', changedFields: ['heading'], label: 'New hero', moved: true, status: 'updated' },
          ],
          removed: [{ id: 'c', blockType: 'grid', label: 'Grid' }],
        },
      ],
      fields: [{ after: 'Homepage', before: 'Home', field: 'title' }],
      mode: 'update',
    })
  })

  test('on create, lists every non-empty field and every block as added', () => {
    const summary = describeChanges(null, { slug: 'x', layout: [{ blockType: 'hero', heading: 'Hi' }], title: '' }, ['layout'])
    expect(summary.mode).toBe('create')
    expect(summary.fields).toEqual([{ after: 'x', field: 'slug' }])
    expect(summary.blocks[0].items).toEqual([{ id: undefined, blockType: 'hero', label: 'Hi', status: 'added' }])
  })
})

describe('previewValue', () => {
  test('summarizes rich text as plain text and arrays by length', () => {
    const richText = { root: { children: [{ children: [{ text: 'Hello' }, { text: 'world' }] }] } }
    expect(previewValue(richText)).toBe('Hello world')
    expect(previewValue([1, 2])).toBe('[2 items]')
    expect(previewValue('x'.repeat(200))).toHaveLength(120)
  })
})
