import type { UIMessage } from 'ai'

/**
 * Pure view logic for the chat screen — what's visible, whether the agent is still working, what
 * Enter does — kept out of the component so it can be unit-tested without a browser.
 */

type Part = UIMessage['parts'][number]

export const isToolPart = (part: Part): boolean => part.type.startsWith('tool-') || part.type === 'dynamic-tool'

export const toolNameOf = (part: Part): string =>
  part.type === 'dynamic-tool' && 'toolName' in part ? part.toolName : part.type.slice('tool-'.length)

export const isApprovalRequest = (
  part: Part,
): part is { approval: { id: string }; input: unknown; state: 'approval-requested' } & Part =>
  'state' in part && part.state === 'approval-requested'

const reasoningText = (part: Part): string => (part.type === 'reasoning' ? part.text.trim() : '')

// Tool-call activity (list_blocks, propose_layout, ...) — and reasoning — is debug info most users
// don't need to see, so it's hidden unless debug mode is on. A pending approval is never just
// "debug info" though: the user has to act on it, so it always stays visible. Allowlisting the real
// content types (rather than just excluding tool parts) also avoids leaving an empty bubble behind
// for part types there's no renderer for.
export const isPartVisible = (part: Part, debugMode: boolean): boolean => {
  if (part.type === 'text') {
    return part.text.trim().length > 0
  }
  if (part.type === 'file') {
    return true
  }
  if (isToolPart(part)) {
    return debugMode || isApprovalRequest(part)
  }
  if (part.type === 'reasoning') {
    return debugMode && reasoningText(part).length > 0
  }
  return false
}

// A message's parts span one or more model "steps" (tool call -> tool result -> more text, etc.),
// marked by `step-start` parts. Rendering each step as its own bubble means content that arrives
// later (e.g. after a tool-approval resumes) shows up as a new message instead of silently growing
// a bubble the user already read.
export const splitIntoSteps = (parts: UIMessage['parts']): UIMessage['parts'][] => {
  const steps: UIMessage['parts'][] = [[]]
  for (const part of parts) {
    if (part.type === 'step-start') {
      if (steps[steps.length - 1].length > 0) {
        steps.push([])
      }
      continue
    }
    steps[steps.length - 1].push(part)
  }
  return steps.filter((step) => step.length > 0)
}

const TOOL_STATUS: Record<string, string> = {
  apply_proposal: 'Applying changes…',
  get_block_schema: 'Checking the block library…',
  get_collection_schema: 'Checking the block library…',
  get_document: 'Reading the current page…',
  list_blocks: 'Checking the block library…',
  list_collections: 'Checking the block library…',
  propose_layout: 'Validating the proposal…',
  revise_proposal: 'Validating the proposal…',
  search_documents: 'Searching documents…',
}

const NOTE_MAX = 160

export type Activity = {
  /** The model's own latest progress note (Claude 5.5 `display: "updates"`), if it wrote one. */
  note?: string
  /** What the agent is doing right now, e.g. "Checking the block library…". */
  status?: string
  visible: boolean
}

/**
 * Whether to show the "agent is working" bubble. It stays up for the whole turn — through hidden
 * reasoning and tool loops that can run 10–25 s — and only steps aside while the user can actually
 * see something happening: answer text streaming in, or an approval card waiting on them.
 */
export const getActivity = (messages: UIMessage[], isStreaming: boolean): Activity => {
  if (!isStreaming) {
    return { visible: false }
  }
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') {
    return { visible: true }
  }

  const steps = splitIntoSteps(last.parts)
  const currentStep = steps.at(-1) ?? []
  const lastPart = currentStep.at(-1)
  if (!lastPart) {
    return { visible: true }
  }
  if ((lastPart.type === 'text' && lastPart.text.trim()) || isApprovalRequest(lastPart)) {
    return { visible: false }
  }

  const status = isToolPart(lastPart)
    ? (TOOL_STATUS[toolNameOf(lastPart)] ?? `Running ${toolNameOf(lastPart)}…`)
    : lastPart.type === 'reasoning'
      ? 'Thinking…'
      : undefined

  const latestNote = [...currentStep].reverse().map(reasoningText).find(Boolean)
  const note = latestNote && latestNote.length > NOTE_MAX ? `${latestNote.slice(0, NOTE_MAX - 1)}…` : latestNote

  return { note, status, visible: true }
}

/**
 * Enter sends, Shift+Enter is a newline. Never send mid-IME-composition (Enter there confirms the
 * composed characters — `keyCode 229` covers Safari, which doesn't set `isComposing`), and never when
 * the Send button itself would be disabled.
 */
export const shouldSubmitOnKeyDown = (
  event: { key: string; keyCode?: number; nativeEvent?: { isComposing?: boolean }; shiftKey: boolean },
  canSend: boolean,
): boolean =>
  event.key === 'Enter' &&
  !event.shiftKey &&
  !event.nativeEvent?.isComposing &&
  event.keyCode !== 229 &&
  canSend
