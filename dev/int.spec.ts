import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

describe('dev app', () => {
  test('boots with the reference block library wired into pages.layout', () => {
    const pages = payload.collections['pages']
    expect(pages).toBeDefined()

    const layoutField = pages.config.fields.find(
      (field) => 'name' in field && field.name === 'layout',
    )
    expect(layoutField).toBeDefined()
    if (!layoutField || layoutField.type !== 'blocks') {
      throw new Error('expected layout field to be a blocks field')
    }

    const slugs = layoutField.blocks.map((block) => block.slug)
    expect(slugs).toEqual(['hero', 'richText', 'cta', 'grid', 'testimonial'])
  })
})
