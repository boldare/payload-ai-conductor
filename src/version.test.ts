import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

import { PLUGIN_VERSION } from './version.js'

describe('PLUGIN_VERSION', () => {
  test('matches package.json (regenerate with `node scripts/sync-version.mjs`)', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
    expect(PLUGIN_VERSION).toBe(version)
  })
})
