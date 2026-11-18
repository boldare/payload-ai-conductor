'use client'

import React, { useEffect, useState } from 'react'

import type { BlockChange, ChangeSummary } from '../../tools/operations.js'

import styles from './ConductorChatView.module.css'

type ProposalInput = {
  collection?: string
  data?: Record<string, unknown>
  id?: number | string
  operations?: Array<{ block?: { blockType?: unknown }; blockId?: string; op: string }>
}

type Preview = { changes: ChangeSummary; valid: true } | { issues: string[]; valid: false }

const formatValue = (value: unknown): string => {
  if (value === undefined || value === null || value === '') {
    return '—'
  }
  if (typeof value === 'string') {
    return `“${value}”`
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value)
}

const STATUS_LABEL: Record<BlockChange['status'], string> = {
  added: 'New',
  unchanged: 'Unchanged',
  updated: 'Changed',
}

const BlockRow = ({ change }: { change: BlockChange }) => (
  <li className={styles.changeBlock} data-status={change.status}>
    <span className={styles.changeBadge} data-status={change.status}>
      {STATUS_LABEL[change.status]}
    </span>
    {change.moved && (
      <span className={styles.changeBadge} data-status="moved">
        Moved
      </span>
    )}
    <code>{change.blockType}</code>
    {change.label && <span className={styles.changeLabel}>{change.label}</span>}
    {change.changedFields && <span className={styles.changeMeta}>({change.changedFields.join(', ')})</span>}
  </li>
)

const ChangeDetails = ({ changes }: { changes: ChangeSummary }) => (
  <>
    {changes.fields.length > 0 && (
      <dl className={styles.changeFields}>
        {changes.fields.map((field) => (
          <React.Fragment key={field.field}>
            <dt>{field.field}</dt>
            <dd>
              {changes.mode === 'update' && (
                <>
                  <span className={styles.changeBefore}>{formatValue(field.before)}</span>
                  {' → '}
                </>
              )}
              {formatValue(field.after)}
            </dd>
          </React.Fragment>
        ))}
      </dl>
    )}
    {changes.blocks.map((blocks) => (
      <div key={blocks.field}>
        <div className={styles.changeHeading}>
          Blocks in <code>{blocks.field}</code>
        </div>
        <ol className={styles.changeBlocks}>
          {blocks.items.map((change, index) => (
            <BlockRow change={change} key={change.id ?? `new-${index}`} />
          ))}
        </ol>
        {blocks.removed.length > 0 && (
          <ul className={styles.changeBlocks}>
            {blocks.removed.map((removed) => (
              <li className={styles.changeBlock} data-status="removed" key={removed.id}>
                <span className={styles.changeBadge} data-status="removed">
                  Removed
                </span>
                <code>{removed.blockType}</code>
                {removed.label && <span className={styles.changeLabel}>{removed.label}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    ))}
    {changes.fields.length === 0 && changes.blocks.length === 0 && (
      <p className={styles.changeMeta}>No changes compared to the current document.</p>
    )}
  </>
)

/** Used while the preview loads, or if it can't be fetched: what the raw tool input alone says. */
const InputSummary = ({ input }: { input: ProposalInput }) => (
  <>
    {input.data && Object.keys(input.data).length > 0 && (
      <p className={styles.changeMeta}>Fields: {Object.keys(input.data).join(', ')}</p>
    )}
    {input.operations && input.operations.length > 0 && (
      <ul className={styles.changeBlocks}>
        {input.operations.map((operation, index) => (
          <li className={styles.changeBlock} key={index}>
            <span className={styles.changeBadge}>{operation.op}</span>
            <code>
              {typeof operation.block?.blockType === 'string' ? operation.block.blockType : (operation.blockId ?? '')}
            </code>
          </li>
        ))}
      </ul>
    )}
  </>
)

const headline = (input: ProposalInput, changes?: ChangeSummary): string => {
  const pick = (key: string): unknown =>
    changes?.fields.find((field) => field.field === key)?.after ?? input.data?.[key]
  const title = pick('title')
  const slug = pick('slug')
  return [typeof title === 'string' ? `“${title}”` : undefined, typeof slug === 'string' ? `/${slug}` : undefined]
    .filter(Boolean)
    .join(' · ')
}

export const ApprovalCard = ({
  approvalId,
  input,
  onRespond,
  previewUrl,
}: {
  approvalId: string
  input: ProposalInput
  onRespond: (id: string, approved: boolean) => void
  previewUrl: string
}) => {
  const [preview, setPreview] = useState<'error' | 'loading' | Preview>('loading')
  const inputKey = JSON.stringify(input)

  useEffect(() => {
    let cancelled = false
    setPreview('loading')
    fetch(previewUrl, {
      body: inputKey,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
      .then((res) => (res.ok ? (res.json() as Promise<Preview>) : Promise.reject(new Error(String(res.status)))))
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview('error'))
    return () => {
      cancelled = true
    }
  }, [previewUrl, inputKey])

  const isUpdate = input.id !== undefined && input.id !== null && input.id !== ''
  const changes = typeof preview === 'object' && preview.valid ? preview.changes : undefined
  const summary = headline(input, changes)

  return (
    <div aria-label="Proposed change awaiting approval" className={styles.approvalCard} role="group">
      <div className={styles.approvalHeader}>
        <span className={styles.changeBadge} data-status={isUpdate ? 'updated' : 'added'}>
          {isUpdate ? 'Update' : 'Create'}
        </span>
        <span>
          <code>{input.collection}</code>
          {isUpdate ? ` #${String(input.id)}` : ' (new document)'}
        </span>
        {summary && <span className={styles.changeLabel}>{summary}</span>}
      </div>

      <div className={styles.approvalBody}>
        {preview === 'loading' && (
          <>
            <p className={styles.changeMeta}>Comparing with the current document…</p>
            <InputSummary input={input} />
          </>
        )}
        {preview === 'error' && (
          <>
            <p className={styles.changeMeta}>Couldn’t load a preview of the changes.</p>
            <InputSummary input={input} />
          </>
        )}
        {changes && <ChangeDetails changes={changes} />}
        {typeof preview === 'object' && !preview.valid && (
          <div className={styles.approvalWarning} role="alert">
            <strong>This proposal no longer validates — applying it will fail:</strong>
            <ul>
              {preview.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className={styles.approvalActions}>
        <span className={styles.changeMeta}>Approving writes this to the database.</span>
        <button className={styles.secondaryButton} onClick={() => onRespond(approvalId, false)} type="button">
          Reject
        </button>
        <button className={styles.primaryButton} onClick={() => onRespond(approvalId, true)} type="button">
          Approve
        </button>
      </div>
    </div>
  )
}
