import type { Payload, TypedUser } from 'payload'

import config from '@payload-config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { searchDocuments } from '../src/tools/lookup.js'
import { applyProposal, validateProposal } from '../src/tools/proposal.js'
import { devUser } from './helpers/credentials.js'

let payload: Payload
let user: TypedUser
let fixtureImagePath: string

afterAll(async () => {
  await payload.destroy()
  fs.rmSync(fixtureImagePath, { force: true })
})

beforeAll(async () => {
  payload = await getPayload({ config })

  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: devUser.email } },
  })
  user = docs[0] as TypedUser

  fixtureImagePath = path.join(os.tmpdir(), 'ai-conductor-fixture.png')
  // 1x1 transparent PNG
  fs.writeFileSync(
    fixtureImagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  )
})

describe('validateProposal', () => {
  test('accepts a valid hero + cta layout', async () => {
    const result = await validateProposal(
      payload,
      {
        data: {
          title: 'Landing',
          slug: 'landing',
          layout: [
            { blockType: 'hero', heading: 'Welcome' },
            { blockType: 'cta', buttonHref: '/start', buttonLabel: 'Start', heading: 'Ready?' },
          ],
        },
        target: { collection: 'pages' },
      },
      { user },
    )

    expect(result).toEqual({ valid: true })
  })

  test('rejects a block missing a required field', async () => {
    const result = await validateProposal(payload, {
      data: { layout: [{ blockType: 'hero' }] },
      target: { collection: 'pages' },
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.join(' ')).toContain('heading')
    }
  })

  test('rejects an unknown blockType', async () => {
    const result = await validateProposal(payload, {
      data: { layout: [{ blockType: 'doesNotExist', heading: 'x' }] },
      target: { collection: 'pages' },
    })

    expect(result.valid).toBe(false)
  })

  test('rejects a relationship pointing at a document that does not exist', async () => {
    const result = await validateProposal(
      payload,
      {
        data: {
          layout: [{ authorName: 'A', blockType: 'testimonial', quote: 'Great!', avatar: 999999 }],
        },
        target: { collection: 'pages' },
      },
      { user },
    )

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.join(' ')).toContain('media:999999')
    }
  })

  test('rejects a relationship it cannot verify because no user is authenticated', async () => {
    const media = await payload.create({
      collection: 'media',
      data: {},
      filePath: fixtureImagePath,
    })

    const result = await validateProposal(payload, {
      data: {
        layout: [{ authorName: 'A', avatar: media.id, blockType: 'testimonial', quote: 'Great!' }],
      },
      target: { collection: 'pages' },
    })

    expect(result.valid).toBe(false)
  })

  test('accepts a relationship pointing at a real, accessible document', async () => {
    const media = await payload.create({
      collection: 'media',
      data: {},
      filePath: fixtureImagePath,
    })

    const result = await validateProposal(
      payload,
      {
        data: {
          layout: [{ authorName: 'A', avatar: media.id, blockType: 'testimonial', quote: 'Great!' }],
        },
        target: { collection: 'pages' },
      },
      { user },
    )

    expect(result).toEqual({ valid: true })
  })

  test('unknown collection is rejected', async () => {
    const result = await validateProposal(payload, {
      data: {},
      target: { collection: 'not-a-real-collection' as never },
    })

    expect(result.valid).toBe(false)
  })
})

describe('applyProposal', () => {
  test('creates a new page when no id is given', async () => {
    const result = await applyProposal(
      payload,
      {
        data: {
          title: 'New Page',
          slug: 'new-page',
          layout: [{ blockType: 'hero', heading: 'Hi there' }],
        },
        target: { collection: 'pages' },
      },
      { user },
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.doc as { title: string }).title).toBe('New Page')
    }
  })

  test('updates an existing page when an id is given', async () => {
    const created = await payload.create({
      collection: 'pages',
      data: { title: 'Original', slug: 'original-page' },
    })

    const result = await applyProposal(
      payload,
      {
        data: { layout: [{ blockType: 'cta', buttonHref: '/x', buttonLabel: 'Go', heading: 'Updated' }] },
        target: { collection: 'pages', id: created.id },
      },
      { user },
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.doc as { id: unknown }).id).toBe(created.id)
    }
  })

  test('refuses to write when validation fails', async () => {
    const result = await applyProposal(
      payload,
      {
        data: { layout: [{ blockType: 'hero' }] },
        target: { collection: 'pages' },
      },
      { user },
    )

    expect(result.success).toBe(false)
  })

  test('refuses to write for an unauthenticated caller, even with otherwise-valid data', async () => {
    const result = await applyProposal(payload, {
      data: { title: 'Should Not Exist', slug: 'should-not-exist' },
      target: { collection: 'pages' },
    })

    expect(result.success).toBe(false)
  })
})

describe('searchDocuments', () => {
  test('finds a page by its title field and returns a usable label', async () => {
    await payload.create({ collection: 'pages', data: { title: 'Findable Page', slug: 'findable-page' } })

    const results = await searchDocuments(payload, { collection: 'pages', query: 'Findable' }, { user })
    expect(results.some((r) => r.label === 'Findable Page')).toBe(true)
  })
})
