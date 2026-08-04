import type { ServerProps } from 'payload'
import type React from 'react'

import { CHAT_VIEW_PATH } from '../../constants.js'

type Props = { collection: string } & ServerProps

export const AskConductorButton: React.FC<Props> = ({ id, collection, payload }) => {
  const viewPath = `${payload.config.routes.admin}${CHAT_VIEW_PATH}`
  const href = id ? `${viewPath}?collection=${collection}&id=${id}` : `${viewPath}?collection=${collection}`

  return (
    <a href={href} style={{ marginRight: 8 }}>
      Ask AI Conductor
    </a>
  )
}
