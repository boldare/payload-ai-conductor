import type { FieldHookArgs } from 'payload'

import { describe, expect, test } from 'vitest'

import { buildSettingsGlobal, encryptApiKey, resolveAllowedCollections, resolveModelConfigFromSettings } from './settings.js'

describe('buildSettingsGlobal', () => {
  test('leaves access unset (Payload default) when no access rule is given', () => {
    const global = buildSettingsGlobal(['pages'])
    expect(global.access).toBeUndefined()
  })

  test('applies a given access rule to both read and update', () => {
    const access = () => true
    const global = buildSettingsGlobal(['pages'], access)
    expect(global.access?.read).toBe(access)
    expect(global.access?.update).toBe(access)
  })

  test('renders the collections field as a select with the given options', () => {
    const global = buildSettingsGlobal(['pages', 'media'])
    const collectionsField = global.fields.find((field) => 'name' in field && field.name === 'collections')
    expect(collectionsField).toMatchObject({ type: 'select', hasMany: true, options: ['pages', 'media'] })
  })
})

describe('encryptApiKey', () => {
  const run = (value: unknown) =>
    encryptApiKey({ req: { payload: { encrypt: (v: string) => `enc(${v})` } }, value } as unknown as FieldHookArgs)

  test('trims whitespace a pasted key often carries before encrypting it', () => {
    expect(run('  sk-ant-test\n')).toBe('enc(sk-ant-test)')
  })

  test('stores nothing for a whitespace-only value and passes empty values through', () => {
    expect(run('   ')).toBeNull()
    expect(run(undefined)).toBeUndefined()
  })
})

describe('resolveAllowedCollections', () => {
  test('falls back to the plugin option when settings has no collections', () => {
    expect(resolveAllowedCollections({ collections: ['pages'] }, {})).toEqual(['pages'])
  })

  test('settings collections win when the plugin option is unset', () => {
    expect(resolveAllowedCollections({}, { collections: ['pages'] })).toEqual(['pages'])
  })

  test('settings can only narrow the plugin option, never widen it', () => {
    const result = resolveAllowedCollections({ collections: ['pages', 'media'] }, { collections: ['media'] })
    expect(result).toEqual(['media'])
  })

  test('settings collections outside the plugin option are dropped, not added', () => {
    const result = resolveAllowedCollections({ collections: ['pages'] }, { collections: ['media'] })
    expect(result).toEqual([])
  })
})

describe('resolveModelConfigFromSettings', () => {
  test('trims a stored key and model id (keys saved before trimming was added)', () => {
    expect(resolveModelConfigFromSettings({ apiKey: ' sk-test\n', model: ' claude-sonnet-5-5 ', provider: 'anthropic' })).toEqual(
      { apiKey: 'sk-test', model: 'claude-sonnet-5-5', provider: 'anthropic' },
    )
  })

  test('returns undefined when any required field is missing', () => {
    expect(resolveModelConfigFromSettings({ model: 'claude-sonnet-5', provider: 'anthropic' })).toBeUndefined()
  })

  test('returns a model config once provider, model, and apiKey are all set', () => {
    const settings = { apiKey: 'sk-test', model: 'claude-sonnet-5', provider: 'anthropic' as const }
    expect(resolveModelConfigFromSettings(settings)).toEqual({
      apiKey: 'sk-test',
      model: 'claude-sonnet-5',
      provider: 'anthropic',
    })
  })
})
