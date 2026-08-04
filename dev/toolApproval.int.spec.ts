import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { UIMessage } from 'ai'
import type { Payload, TypedUser } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import { readUIMessageStream } from 'ai'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createChatEndpointHandler } from '../src/agent/chatEndpoint.js'
import { devUser } from './helpers/credentials.js'

let payload: Payload
let user: TypedUser

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'users', where: { email: { equals: devUser.email } } })
  user = docs[0] as TypedUser
})

const makeRequest = (body: unknown) =>
  new Request('http://localhost:3000/api/plugin/ai-conductor/chat', {
    body: JSON.stringify(body),
    method: 'POST',
  }) as unknown as Parameters<ReturnType<typeof createChatEndpointHandler>>[0]

// Mirrors what the real `useChat()` client does: parse the SSE body into UI message chunks and
// fold them onto a (possibly seeded) message, exactly like `processUIMessageStream` does internally.
const reconstructMessage = async (res: Response, seedMessage?: UIMessage): Promise<UIMessage> => {
  const text = await res.text()
  const chunks = text
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice('data: '.length)))

  let last: UIMessage | undefined
  for await (const message of readUIMessageStream({ message: seedMessage, stream: convertArrayToReadableStream(chunks) })) {
    last = message
  }
  if (!last) {
    throw new Error('Stream produced no messages')
  }
  return last
}

describe('tool approval flow', () => {
  test('an approved apply_proposal call resumes cleanly and actually writes the document', async () => {
    const applyProposalInput = {
      collection: 'pages',
      data: {
        title: 'Approval Test',
        slug: 'approval-test-page',
        layout: [{ blockType: 'hero', heading: 'Hi there' }],
      },
    }

    const finishTextPart = (text: string): LanguageModelV4StreamPart[] => [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: '1' },
      { type: 'text-delta', delta: text, id: '1' },
      { type: 'text-end', id: '1' },
      {
        type: 'finish',
        finishReason: { raw: undefined, unified: 'stop' },
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
          outputTokens: { reasoning: 0, text: 5, total: 5 },
        },
      },
    ]

    let callCount = 0
    const mockModel = new MockLanguageModelV4({
      doStream: async () => {
        callCount += 1
        let streamParts: LanguageModelV4StreamPart[]
        if (callCount === 1) {
          // Turn 0, step 1: an ordinary (non-approval) tool call.
          streamParts = [
            { type: 'stream-start', warnings: [] },
            { type: 'tool-call', input: '{}', toolCallId: 'call_list', toolName: 'list_collections' },
            {
              type: 'finish',
              finishReason: { raw: undefined, unified: 'tool-calls' },
              usage: {
                inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
                outputTokens: { reasoning: 0, text: 5, total: 5 },
              },
            },
          ]
        } else if (callCount === 2) {
          // Turn 0, step 2: propose the layout back to the user in plain text.
          streamParts = finishTextPart('Here is the proposed layout — want me to apply it?')
        } else if (callCount === 3) {
          // Turn 1 ("Apply"): a fresh tool call requiring approval.
          streamParts = [
            { type: 'stream-start', warnings: [] },
            {
              type: 'tool-call',
              input: JSON.stringify(applyProposalInput),
              toolCallId: 'call_1',
              toolName: 'apply_proposal',
            },
            {
              type: 'finish',
              finishReason: { raw: undefined, unified: 'tool-calls' },
              usage: {
                inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
                outputTokens: { reasoning: 0, text: 5, total: 5 },
              },
            },
          ]
        } else {
          streamParts = finishTextPart('Done!')
        }
        return { stream: convertArrayToReadableStream(streamParts) }
      },
    })

    const handler = createChatEndpointHandler(
      { collections: ['pages'], getModelConfig: () => ({ apiKey: 'test', model: 'test', provider: 'openai' }) },
      { buildLanguageModel: () => mockModel },
    )

    const userMessage = { id: 'u1', parts: [{ text: 'create the page', type: 'text' as const }], role: 'user' as const }

    // Turn 0: an ordinary multi-step turn (matching the real conversation's list_blocks/propose_layout
    // steps) that completes fully within one request, with no approval involved.
    const req0 = makeRequest({ id: 'conv_1', messages: [userMessage] })
    req0.payload = payload
    req0.user = user
    req0.locale = undefined
    const res0 = await handler(req0)
    const message0 = await reconstructMessage(res0)

    const applyMessage = { id: 'u2', parts: [{ text: 'Apply', type: 'text' as const }], role: 'user' as const }

    // Turn 1: user says "Apply" — a fresh assistant message calls apply_proposal, requiring approval.
    const req1 = makeRequest({ id: 'conv_1', messages: [userMessage, message0, applyMessage] })
    req1.payload = payload
    req1.user = user
    req1.locale = undefined

    const res1 = await handler(req1)
    const message1 = await reconstructMessage(res1)
    const toolPart = message1.parts.find((part) => part.type === 'tool-apply_proposal')
    expect(toolPart).toBeDefined()
    if (!toolPart || toolPart.type !== 'tool-apply_proposal') {
      throw new Error('expected an apply_proposal tool part')
    }
    expect(toolPart.state).toBe('approval-requested')
    const approvalId = toolPart.approval?.id
    expect(approvalId).toBeDefined()

    const beforeApproval = await payload.find({
      collection: 'pages',
      where: { slug: { equals: 'approval-test-page' } },
    })
    expect(beforeApproval.totalDocs).toBe(0)

    // Client-side approval resolves that same tool part in place (mirrors addToolApprovalResponse),
    // then the transport resubmits the full history — this must resume cleanly and actually run the tool.
    const approvedMessage1: UIMessage = {
      ...message1,
      parts: message1.parts.map((part) =>
        part.type === 'tool-apply_proposal'
          ? ({
              ...part,
              approval: { ...part.approval, approved: true },
              state: 'approval-responded',
            } as UIMessage['parts'][number])
          : part,
      ),
    }

    const req2 = makeRequest({ id: 'conv_1', messages: [userMessage, message0, applyMessage, approvedMessage1] })
    req2.payload = payload
    req2.user = user
    req2.locale = undefined

    const res2 = await handler(req2)
    expect(res2.status).toBe(200)

    // This is the exact reconciliation the real client performs — if the server doesn't correctly
    // continue the same message/tool call, this throws `AI_UIMessageStreamError` here.
    const message2 = await reconstructMessage(res2, approvedMessage1)

    const resolvedToolPart = message2.parts.find((part) => part.type === 'tool-apply_proposal')
    expect(resolvedToolPart).toBeDefined()
    if (!resolvedToolPart || resolvedToolPart.type !== 'tool-apply_proposal') {
      throw new Error('expected an apply_proposal tool part')
    }
    expect(resolvedToolPart.state).toBe('output-available')
    expect(resolvedToolPart.output).toMatchObject({ success: true })

    const afterApproval = await payload.find({
      collection: 'pages',
      where: { slug: { equals: 'approval-test-page' } },
    })
    expect(afterApproval.totalDocs).toBe(1)
  })
})
