import type { ServerProps } from 'payload'
import type React from 'react'

import { CHAT_VIEW_PATH } from '../../constants.js'

export const ConductorNavLink: React.FC<ServerProps> = ({ payload }) => {
  return (
    <a className="nav__link" href={`${payload.config.routes.admin}${CHAT_VIEW_PATH}`}>
      <span className="nav__link-label">AI Conductor</span>
    </a>
  )
}
