import type { UIMessage } from 'ai'

import { describe, expect, test } from 'vitest'

import { describeChatError } from './chatErrorCopy.js'
import { getActivity, isPartVisible, shouldSubmitOnKeyDown } from './chatState.js'

type Part = UIMessage['parts'][number]

const user: UIMessage = { id: 'u', parts: [{ type: 'text', text: 'Build a page' }], role: 'user' }
const assistant = (...parts: Part[]): UIMessage => ({ id: 'a', parts, role: 'assistant' })
const tool = (name: string, state: string, extra: Record<string, unknown> = {}) =>
  ({ type: `tool-${name}`, input: {}, state, toolCallId: name, ...extra }) as unknown as Part
const reasoning = (text: string) => ({ type: 'reasoning', state: 'done', text }) as Part
const text = (value: string) => ({ type: 'text', state: 'streaming', text: value }) as Part

describe('getActivity — the "agent is working" bubble', () => {
  test('hidden when nothing is streaming', () => {
    expect(getActivity([user], false).visible).toBe(false)
  })

  test('shown as soon as the user message is sent', () => {
    expect(getActivity([user], true)).toEqual({ visible: true })
  })

  test('stays up through hidden reasoning and tool calls (the bug: it vanished after the first part)', () => {
    const messages = [
      user,
      assistant(
        { type: 'step-start' } as Part,
        reasoning(''),
        tool('list_blocks', 'output-available'),
        { type: 'step-start' } as Part,
        tool('get_block_schema', 'input-available'),
      ),
    ]
    expect(getActivity(messages, true)).toEqual({ note: undefined, status: 'Checking the block library…', visible: true })
  })

  test('shows the model’s latest progress note from the current step under the status', () => {
    const messages = [
      user,
      assistant(
        { type: 'step-start' } as Part,
        reasoning('Old note from the previous step'),
        tool('list_blocks', 'output-available'),
        { type: 'step-start' } as Part,
        reasoning('Hero, grid and CTA fit — validating the layout.'),
        reasoning(''),
        tool('propose_layout', 'input-streaming'),
      ),
    ]
    expect(getActivity(messages, true)).toEqual({
      note: 'Hero, grid and CTA fit — validating the layout.',
      status: 'Validating the proposal…',
      visible: true,
    })
  })

  test('steps aside while answer text streams in or an approval card is waiting', () => {
    expect(getActivity([user, assistant(tool('list_blocks', 'output-available'), text('Here is'))], true).visible).toBe(
      false,
    )
    const approval = tool('apply_proposal', 'approval-requested', { approval: { id: 'ap' } })
    expect(getActivity([user, assistant(approval)], true).visible).toBe(false)
  })

  test('comes back once the approval is answered and the write runs', () => {
    const responded = tool('apply_proposal', 'approval-responded', { approval: { id: 'ap', approved: true } })
    expect(getActivity([user, assistant(responded)], true)).toMatchObject({ status: 'Applying changes…', visible: true })
  })

  test('empty text placeholders (text-start before any delta) keep the bubble up', () => {
    expect(getActivity([user, assistant(text(''))], true).visible).toBe(true)
  })
})

describe('isPartVisible', () => {
  test('reasoning is debug-only, and empty reasoning never renders an empty bubble', () => {
    expect(isPartVisible(reasoning('a note'), false)).toBe(false)
    expect(isPartVisible(reasoning('a note'), true)).toBe(true)
    expect(isPartVisible(reasoning(''), true)).toBe(false)
  })

  test('approval requests are always visible; other tool calls only in debug mode', () => {
    expect(isPartVisible(tool('apply_proposal', 'approval-requested', { approval: { id: 'x' } }), false)).toBe(true)
    expect(isPartVisible(tool('list_blocks', 'output-available'), false)).toBe(false)
    expect(isPartVisible(tool('list_blocks', 'output-available'), true)).toBe(true)
  })
})

describe('shouldSubmitOnKeyDown', () => {
  const enter = { key: 'Enter', shiftKey: false }

  test('Enter sends, Shift+Enter does not', () => {
    expect(shouldSubmitOnKeyDown(enter, true)).toBe(true)
    expect(shouldSubmitOnKeyDown({ ...enter, shiftKey: true }, true)).toBe(false)
  })

  test('never during IME composition', () => {
    expect(shouldSubmitOnKeyDown({ ...enter, nativeEvent: { isComposing: true } }, true)).toBe(false)
    expect(shouldSubmitOnKeyDown({ ...enter, keyCode: 229 }, true)).toBe(false)
  })

  test('never when sending is disabled (empty, streaming or uploading)', () => {
    expect(shouldSubmitOnKeyDown(enter, false)).toBe(false)
  })
})

describe('describeChatError', () => {
  test('explains each failure mode, with a Settings link where Settings is the fix', () => {
    const notConfigured = describeChatError(new Error('{"code":"model_not_configured","message":"AI Conductor: no model configured."}'))
    expect(notConfigured).toMatchObject({ showSettingsLink: true, title: 'No AI model is configured' })

    const badKey = describeChatError(new Error('{"code":"invalid_api_key","message":"invalid x-api-key"}'))
    expect(badKey).toMatchObject({ detail: 'invalid x-api-key', showSettingsLink: true })

    const offline = describeChatError(new Error('{"code":"connection_failed","message":"Cannot connect to API: ETIMEDOUT"}'))
    expect(offline).toMatchObject({ showSettingsLink: false, title: 'Can’t reach the model provider' })

    expect(describeChatError(new Error('An error occurred.'))).toMatchObject({ detail: undefined, title: 'Something went wrong' })
  })
})
