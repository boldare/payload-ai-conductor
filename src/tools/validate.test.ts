import type { Field } from 'payload'

import { describe, expect, test } from 'vitest'

import { validateFieldsData } from './validate.js'

const blocksField = (extra: Record<string, unknown> = {}): Field =>
  ({
    name: 'layout',
    type: 'blocks',
    blocks: [{ slug: 'hero', fields: [{ name: 'heading', type: 'text', required: true }] }],
    ...extra,
  }) as Field

describe('validateFieldsData', () => {
  test('a required field with a defaultValue is not required input', () => {
    const fields: Field[] = [{ name: 'style', type: 'select', defaultValue: 'a', options: ['a', 'b'], required: true }]
    expect(validateFieldsData(fields, {})).toEqual([])
  })

  test('optional fields accept null, as stored documents return them', () => {
    const fields: Field[] = [
      { name: 'subtitle', type: 'text' },
      { name: 'image', type: 'upload', relationTo: 'media' },
    ]
    expect(validateFieldsData(fields, { image: null, subtitle: null })).toEqual([])
  })

  test('blocks minRows/maxRows follow Payload semantics', () => {
    const fields = [blocksField({ maxRows: 2, minRows: 2 })]
    const hero = { blockType: 'hero', heading: 'x' }

    // Not required + empty is allowed even with minRows, exactly like Payload's validateArrayLength.
    expect(validateFieldsData(fields, { layout: [] })).toEqual([])
    expect(validateFieldsData(fields, { layout: [hero] })).toEqual(['layout: needs at least 2 item(s), got 1'])
    expect(validateFieldsData(fields, { layout: [hero, hero, hero] })).toEqual([
      'layout: allows at most 2 item(s), got 3',
    ])
  })

  test('a required array needs at least one row', () => {
    const fields: Field[] = [{ name: 'items', type: 'array', fields: [{ name: 'title', type: 'text' }], required: true }]
    expect(validateFieldsData(fields, { items: [] })).toEqual(['items: needs at least 1 item'])
  })

  test('array rows reject unknown keys but accept their stored id', () => {
    const fields: Field[] = [{ name: 'items', type: 'array', fields: [{ name: 'title', type: 'text' }] }]
    expect(validateFieldsData(fields, { items: [{ id: 'abc', title: 'A' }] })).toEqual([])
    expect(validateFieldsData(fields, { items: [{ subtitle: 'B', title: 'A' }] })[0]).toContain('"subtitle"')
  })

  test('an unknown blockType lists the available blocks', () => {
    expect(validateFieldsData([blocksField()], { layout: [{ blockType: 'banner' }] })).toEqual([
      'layout[0:banner].blockType: unknown blockType "banner" (available: hero)',
    ])
  })

  test('issues inside a block name the block in the path', () => {
    expect(validateFieldsData([blocksField()], { layout: [{ blockType: 'hero' }] })).toEqual([
      'layout[0:hero].heading: is required',
    ])
  })

  test('text length limits and required-but-empty strings are caught', () => {
    const fields: Field[] = [{ name: 'title', type: 'text', maxLength: 5, required: true }]
    expect(validateFieldsData(fields, { title: '' })).toEqual(['title: is required'])
    expect(validateFieldsData(fields, { title: 'too long' })).toEqual(['title: must be at most 5 characters'])
  })

  test('a required field inside an omitted group is still reported', () => {
    const fields: Field[] = [{ name: 'seo', type: 'group', fields: [{ name: 'title', type: 'text', required: true }] }]
    expect(validateFieldsData(fields, {})).toEqual(['seo.title: is required'])
  })

  test('join and virtual fields are not writable', () => {
    const fields = [
      { name: 'related', type: 'join', collection: 'posts', on: 'page' },
      { name: 'computed', type: 'text', virtual: true },
    ] as Field[]
    const issues = validateFieldsData(fields, { computed: 'x', related: [] })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('"related"')
    expect(issues[0]).toContain('"computed"')
  })
})
