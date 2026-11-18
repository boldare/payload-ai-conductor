'use client'

import type { UIMessage } from 'ai'

import { useChat } from '@ai-sdk/react'
import { useConfig } from '@payloadcms/ui'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import { useSearchParams } from 'next/navigation.js'
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { Activity } from './chatState.js'

import { CHAT_ENDPOINT_PATH, UPLOAD_ENDPOINT_PATH } from '../../constants.js'
import { describeChatError } from './chatErrorCopy.js'
import {
  getActivity,
  isApprovalRequest,
  isPartVisible,
  isToolPart,
  shouldSubmitOnKeyDown,
  splitIntoSteps,
  toolNameOf,
} from './chatState.js'
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

/** Textarea grows with its content up to this many lines, then scrolls inside. */
const COMPOSER_MAX_LINES = 6

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(reader.error?.message ?? 'Failed to read file'))
    reader.readAsDataURL(file)
  })

const PaperclipIcon = () => (
  <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
    <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
  </svg>
)

const ArrowUpIcon = () => (
  <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.25" viewBox="0 0 24 24" width="18">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
)

const StopIcon = () => (
  <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14">
    <rect height="16" rx="3" width="16" x="4" y="4" />
  </svg>
)

const ThinkingBubble = ({ activity }: { activity: Activity }) => (
  <div className={`${styles.messageRow} ${styles.messageRowAssistant}`}>
    <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
      <div className={styles.messageLabel}>AI Conductor</div>
      <div aria-label={activity.status ?? 'AI Conductor is working'} className={styles.activity} role="status">
        <span className={styles.thinkingDots}>
          <span />
          <span />
          <span />
        </span>
        {activity.status && <span className={styles.activityStatus}>{activity.status}</span>}
      </div>
      {activity.note && <div className={styles.activityNote}>{activity.note}</div>}
    </div>
  </div>
)

const ErrorPanel = ({ error, settingsUrl }: { error: Error; settingsUrl: string }) => {
  const copy = describeChatError(error)
  return (
    <div className={styles.errorPanel} role="alert">
      <strong>{copy.title}</strong>
      <p>{copy.hint}</p>
      {copy.detail && <code className={styles.errorDetail}>{copy.detail}</code>}
      {copy.showSettingsLink && (
        <a className={styles.errorLink} href={settingsUrl}>
          Open AI Conductor Settings
        </a>
      )}
    </div>
  )
}

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

  if (part.type === 'reasoning') {
    return <p className={styles.reasoning}>{part.text}</p>
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
    const state = 'state' in part ? part.state : undefined
    const hasDetails = ('output' in part && part.output != null) || ('errorText' in part && Boolean(part.errorText))

    return (
      <div className={styles.toolCard}>
        <details>
          <summary className={styles.toolSummary}>
            <strong>{toolNameOf(part)}</strong> <span className={styles.toolMeta}>({state})</span>
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

  const api = config.routes.api
  const settingsUrl = `${config.routes.admin}/globals/ai-conductor-settings`

  // "Ask AI Conductor" on an edit view opens this screen with ?collection=&id= — send that along
  // with every request so the agent knows which document "this page" is.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${api}${CHAT_ENDPOINT_PATH}`,
        body: collection ? { context: { id: id ?? undefined, collection } } : undefined,
      }),
    [api, collection, id],
  )

  const { addToolApprovalResponse, error, messages, sendMessage, status, stop } = useChat({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    transport,
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isStreaming = status === 'streaming' || status === 'submitted'
  const isUploading = attachments.some((attachment) => attachment.status === 'uploading')
  const canSend = !isStreaming && !isUploading && (input.trim().length > 0 || attachments.some((a) => a.status === 'done'))
  const activity = getActivity(messages, isStreaming)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, activity.visible, error])

  // Auto-grow: fit the content, capped at COMPOSER_MAX_LINES, scrolling inside beyond that.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    const style = window.getComputedStyle(textarea)
    const lineHeight = parseFloat(style.lineHeight) || 20
    const maxHeight =
      lineHeight * COMPOSER_MAX_LINES + parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0')
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [input])

  const uploadAttachment = async (attachment: Attachment) => {
    try {
      const formData = new FormData()
      formData.set('file', attachment.file)

      const res = await fetch(`${api}${UPLOAD_ENDPOINT_PATH}`, { body: formData, method: 'POST' })
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

  const submit = async () => {
    if (!canSend) {
      return
    }
    const uploaded = attachments.filter((a) => a.status === 'done' && a.result)

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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void submit()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }
    // Plain Enter never inserts a newline — it sends, or does nothing while sending isn't possible.
    if (!event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault()
    }
    if (shouldSubmitOnKeyDown(event, canSend)) {
      void submit()
    }
  }

  return (
    <div className={styles.page}>
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
        {activity.visible && <ThinkingBubble activity={activity} />}
        {error && <ErrorPanel error={error} settingsUrl={settingsUrl} />}
        <div ref={messagesEndRef} />
      </div>

      <form className={styles.composer} onSubmit={handleSubmit}>
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
                  className={styles.chipRemove}
                  onClick={() => removeAttachment(attachment.id)}
                  type="button"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.inputShell}>
          <button
            aria-label="Attach files"
            className={styles.iconButton}
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
            type="button"
          >
            <PaperclipIcon />
          </button>
          <input
            aria-label="Attach files"
            hidden
            multiple
            onChange={(event) => {
              handleFilesSelected(event.target.files)
              event.target.value = ''
            }}
            ref={fileInputRef}
            type="file"
          />
          <textarea
            aria-label="Message"
            className={styles.textarea}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI Conductor to build or edit a page..."
            ref={textareaRef}
            rows={1}
            value={input}
          />
          {isStreaming ? (
            <button aria-label="Stop" className={styles.stopButton} onClick={() => stop()} title="Stop" type="button">
              <StopIcon />
            </button>
          ) : (
            <button aria-label="Send" className={styles.sendButton} disabled={!canSend} title="Send" type="submit">
              <ArrowUpIcon />
            </button>
          )}
        </div>
        <p className={styles.composerHint}>Enter to send · Shift+Enter for a new line</p>
      </form>
    </div>
  )
}
