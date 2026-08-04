import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import React from 'react'

import { getSettings } from '../../globals/settings.js'
import { ConductorChatView } from '../client/ConductorChatView.js'

export const ConductorChatPage: React.FC<AdminViewServerProps> = async ({
  initPageResult: { locale, permissions, req, visibleEntities },
  params,
  payload,
  searchParams,
  viewType,
}) => {
  const settings = await getSettings(payload)

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={req.user ?? undefined}
      viewType={viewType}
      visibleEntities={visibleEntities}
    >
      <ConductorChatView debugMode={settings.debugMode ?? false} />
    </DefaultTemplate>
  )
}
