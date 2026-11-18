import { describe, expect, test } from 'vitest'

import { applyBlockOperations } from './operations.js'

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
