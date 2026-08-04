'use client'

import type { UIMessage } from 'ai'

import { useChat } from '@ai-sdk/react'
import { useConfig } from '@payloadcms/ui'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import { useSearchParams } from 'next/navigation.js'
import React, { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { CHAT_ENDPOINT_PATH, UPLOAD_ENDPOINT_PATH } from '../../constants.js'
import styles from './ConductorChatView.module.css'

type UploadedAttachment = { collection: string; id: number | string; mimeType: string; name: string; url?: string }

type Attachment = {
  error?: string
  file: File
  id: string
  previewUrl?: string
  result?: UploadedAttachment
  status: 'done' | 'error' | 'uploading'
}

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(reader.error?.message ?? 'Failed to read file'))
    reader.readAsDataURL(file)
  })

const isApprovalRequest = (part: UIMessage['parts'][number]): part is {
  approval: { id: string }
  state: 'approval-requested'
} & UIMessage['parts'][number] => 'state' in part && part.state === 'approval-requested'

const isToolPart = (part: UIMessage['parts'][number]): boolean =>
  part.type.startsWith('tool-') || part.type === 'dynamic-tool'

// Tool-call activity (list_blocks, propose_layout, ...) — and anything else MessagePart doesn't
// render as real content, like reasoning traces — is debug info most users don't need to see, so
// it's hidden unless debug mode is on. A pending approval is never just "debug info" though: the
// user has to act on it, so it always stays visible regardless of this setting. Allowlisting the
// real content types (rather than just excluding tool parts) also avoids leaving an empty bubble
// behind for part types MessagePart has no renderer for.
const isPartVisible = (part: UIMessage['parts'][number], debugMode: boolean): boolean => {
  if (part.type === 'text' || part.type === 'file') {
    return true
  }
  if (isToolPart(part)) {
    return debugMode || isApprovalRequest(part)
  }
  return debugMode
}

// A message's parts span one or more model "steps" (tool call -> tool result -> more text, etc.),
// marked by `step-start` parts. Rendering each step as its own bubble means content that arrives
// later (e.g. after a tool-approval resumes) shows up as a new message instead of silently growing
// a bubble the user already read.
const splitIntoSteps = (parts: UIMessage['parts']): UIMessage['parts'][] => {
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

const ThinkingBubble = () => (
  <div className={`${styles.messageRow} ${styles.messageRowAssistant}`}>
    <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
      <div className={styles.messageLabel}>AI Conductor</div>
      <div aria-label="AI Conductor is thinking" className={styles.thinkingDots} role="status">
        <span />
        <span />
        <span />
      </div>
    </div>
  </div>
)

const MessagePart = ({
  onRespond,
  part,
}: {
  onRespond: (id: string, approved: boolean) => void
  part: UIMessage['parts'][number]
}) => {
  if (part.type === 'text') {
    return (
      <div className={styles.markdown}>
        <Markdown remarkPlugins={[remarkGfm]}>{part.text}</Markdown>
      </div>
    )
  }

  if (part.type === 'file') {
    return part.mediaType.startsWith('image/') ? (
      <img alt={part.filename ?? 'Attached image'} className={styles.messageImage} src={part.url} />
    ) : (
      <p className={styles.toolMeta}>
        <span aria-label="Attachment" role="img">
          📎
        </span>{' '}
        {part.filename ?? 'attachment'}
      </p>
    )
  }

  if (isToolPart(part)) {
    const toolName = part.type === 'dynamic-tool' ? part.toolName : part.type.slice('tool-'.length)
    const state = 'state' in part ? part.state : undefined
    const hasDetails = ('output' in part && part.output != null) || ('errorText' in part && Boolean(part.errorText))

    return (
      <div className={styles.toolCard}>
        <details>
          <summary className={styles.toolSummary}>
            <strong>{toolName}</strong> <span className={styles.toolMeta}>({state})</span>
          </summary>
          {hasDetails ? (
            <>
              {'output' in part && part.output != null && (
                <pre className={styles.toolOutput}>{JSON.stringify(part.output, null, 2)}</pre>
              )}
              {'errorText' in part && part.errorText && <p className={styles.errorText}>{part.errorText}</p>}
            </>
          ) : (
            <p className={styles.toolMeta}>No details yet.</p>
          )}
        </details>
        {isApprovalRequest(part) && (
          <div style={{ marginTop: 8 }}>
            <p>This will write to the database. Apply it?</p>
            <button onClick={() => onRespond(part.approval.id, true)} type="button">
              Approve
            </button>{' '}
            <button onClick={() => onRespond(part.approval.id, false)} type="button">
              Reject
            </button>
          </div>
        )}
      </div>
    )
  }

  return null
}

export const ConductorChatView: React.FC<{ debugMode?: boolean }> = ({ debugMode = false }) => {
  const { config } = useConfig()
  const searchParams = useSearchParams()
  const collection = searchParams.get('collection')
  const id = searchParams.get('id')
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])

  const { addToolApprovalResponse, error, messages, sendMessage, status, stop } = useChat({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    transport: new DefaultChatTransport({ api: `${config.routes.api}${CHAT_ENDPOINT_PATH}` }),
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const isStreaming = status === 'streaming' || status === 'submitted'
  const isUploading = attachments.some((attachment) => attachment.status === 'uploading')

  const lastMessage = messages.at(-1)
  const lastPart = lastMessage?.parts.at(-1)
  const isThinking = isStreaming && (!lastMessage || lastMessage.role !== 'assistant' || !lastPart || lastPart.type === 'step-start')

  const uploadAttachment = async (attachment: Attachment) => {
    try {
      const formData = new FormData()
      formData.set('file', attachment.file)

      const res = await fetch(`${config.routes.api}${UPLOAD_ENDPOINT_PATH}`, { body: formData, method: 'POST' })
      const data = (await res.json()) as { error?: string; issues?: string[] } & Partial<UploadedAttachment>

      if (!res.ok || !data.id) {
        const message = data.error ?? data.issues?.[0] ?? 'Upload failed'
        setAttachments((prev) => prev.map((a) => (a.id === attachment.id ? { ...a, error: message, status: 'error' } : a)))
        return
      }

      setAttachments((prev) =>
        prev.map((a) => (a.id === attachment.id ? { ...a, result: data as UploadedAttachment, status: 'done' } : a)),
      )
    } catch {
      setAttachments((prev) =>
        prev.map((a) => (a.id === attachment.id ? { ...a, error: 'Upload failed', status: 'error' } : a)),
      )
    }
  }

  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList?.length) {
      return
    }

    const newAttachments: Attachment[] = Array.from(fileList).map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      status: 'uploading',
    }))

    setAttachments((prev) => [...prev, ...newAttachments])
    newAttachments.forEach((attachment) => void uploadAttachment(attachment))
  }

  const removeAttachment = (attachmentId: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === attachmentId)
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl)
      }
      return prev.filter((a) => a.id !== attachmentId)
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const uploaded = attachments.filter((a) => a.status === 'done' && a.result)
    if (!input.trim() && uploaded.length === 0) {
      return
    }

    const notes = uploaded.map((a) => `[Attached: ${a.result!.collection}#${a.result!.id} "${a.result!.name}"]`)
    const text = [input.trim(), ...notes].filter(Boolean).join('\n\n')

    // Most model providers only accept HTTPS image URLs, which a local dev server can't offer —
    // inline the image as a data URL in that case instead of passing the hosted url through.
    const images = uploaded.filter((a) => a.result!.mimeType.startsWith('image/'))
    const files = await Promise.all(
      images.map(async (a) => ({
        type: 'file' as const,
        filename: a.result!.name,
        mediaType: a.result!.mimeType,
        url: a.result!.url?.startsWith('https://') ? a.result!.url : await fileToDataUrl(a.file),
      })),
    )

    void sendMessage({ files, text })
    setInput('')
    attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl))
    setAttachments([])
  }

  return (
    <div className={styles.page} style={{ margin: '0 auto', maxWidth: 1100, padding: 24 }}>
      <div className={styles.header}>
        <h1>AI Conductor</h1>
        {collection && (
          <p className={styles.contextLine}>
            Context: <code>{collection}</code>
            {id ? ` #${id}` : ' (new document)'}
          </p>
        )}
      </div>

      <div className={styles.messages}>
        {messages.map((message) =>
          splitIntoSteps(message.parts)
            .map((stepParts) => stepParts.filter((part) => isPartVisible(part, debugMode)))
            .filter((stepParts) => stepParts.length > 0)
            .map((stepParts, stepIndex) => (
              <div
                className={`${styles.messageRow} ${message.role === 'user' ? styles.messageRowUser : styles.messageRowAssistant}`}
                key={`${message.id}-${stepIndex}`}
              >
                <div className={`${styles.bubble} ${message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}>
                  <div className={styles.messageLabel}>{message.role === 'user' ? 'You' : 'AI Conductor'}</div>
                  {stepParts.map((part, index) => (
                    <MessagePart
                      key={index}
                      onRespond={(approvalId, approved) => void addToolApprovalResponse({ id: approvalId, approved })}
                      part={part}
                    />
                  ))}
                </div>
              </div>
            )),
        )}
        {isThinking && <ThinkingBubble />}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <p className={styles.errorText} role="alert">
          {error.message || 'Something went wrong talking to the model.'}
        </p>
      )}

      <form className={styles.footer} onSubmit={handleSubmit}>
        {attachments.length > 0 && (
          <ul className={styles.attachmentList}>
            {attachments.map((attachment) => (
              <li className={styles.attachmentChip} key={attachment.id}>
                {attachment.previewUrl ? (
                  <img alt="" className={styles.attachmentThumb} src={attachment.previewUrl} />
                ) : null}
                <span>{attachment.file.name}</span>
                {attachment.status === 'uploading' && <span className={styles.toolMeta}>uploading…</span>}
                {attachment.status === 'error' && <span className={styles.errorText}>{attachment.error}</span>}
                <button
                  aria-label={`Remove ${attachment.file.name}`}
                  onClick={() => removeAttachment(attachment.id)}
                  type="button"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          aria-label="Message"
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask AI Conductor to build or edit a page..."
          rows={3}
          style={{ width: '100%' }}
          value={input}
        />
        <div className={styles.formFooter}>
          <label className={styles.actionButton}>
            Attach files
            <input
              aria-label="Attach files"
              hidden
              multiple
              onChange={(event) => {
                handleFilesSelected(event.target.files)
                event.target.value = ''
              }}
              type="file"
            />
          </label>
          <div className={styles.sendControls}>
            <button
              className={styles.actionButton}
              disabled={isStreaming || isUploading || (!input.trim() && attachments.length === 0)}
              type="submit"
            >
              Send
            </button>
            {isStreaming && (
              <button className={styles.actionButton} onClick={() => stop()} type="button">
                Stop
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
