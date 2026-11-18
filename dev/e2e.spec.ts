import { expect, test } from '@playwright/test'

const login = async (page: import('@playwright/test').Page) => {
  await page.goto('/admin')
  await page.fill('#field-email', 'dev@payloadcms.com')
  await page.fill('#field-password', 'test')
  await page.click('.form-submit button')
  await expect(page).toHaveTitle(/Dashboard/)
}

// The nav sidebar renders off-canvas (collapsed behind a hamburger toggle) by
// default, regardless of viewport width — it has to be opened explicitly before
// any nav link, built-in or ours, is actually visible/clickable.
const openNav = async (page: import('@playwright/test').Page) => {
  await page.click('button[aria-label="Open Menu"], button:has-text("Open Menu")')
  await expect(page.locator('a.nav__link').first()).toBeVisible()
}

// this is an example Playwright e2e test
test('should render admin panel logo', async ({ page }) => {
  await login(page)
  await expect(page.locator('.graphic-icon')).toBeVisible()
})

test('nav link opens the AI Conductor chat view', async ({ page }) => {
  await login(page)
  await openNav(page)

  await page.getByRole('link', { exact: true, name: 'AI Conductor' }).click()
  await expect(page).toHaveURL(/\/admin\/ai-conductor$/)
  await expect(page.getByRole('heading', { name: 'AI Conductor' })).toBeVisible()
  await expect(page.getByPlaceholder('Ask AI Conductor to build or edit a page...')).toBeVisible()
})

test('the document-controls button deep-links into the chat view with doc context', async ({ page }) => {
  await login(page)

  await page.goto('/admin/collections/pages/create')
  await page.fill('#field-title', 'E2E Test Page')
  await page.fill('#field-slug', 'e2e-test-page')
  await page.click('#action-save')
  await expect(page.locator('.payload-toast-item')).toContainText(/successfully/i)

  await page.click('a:has-text("Ask AI Conductor")')
  await expect(page).toHaveURL(/\/admin\/ai-conductor\?collection=pages&id=\d+$/)
  // Scoped to our context line — the nav's "Pages" link also matches a bare text search once the nav
  // is open (Payload remembers that per user, so it depends on test order).
  await expect(page.locator('p', { hasText: 'Context:' })).toContainText('pages')

  // The doc context travels with the chat request itself, not just the URL.
  const chatRequest = page.waitForRequest((req) => req.url().endsWith('/api/plugin/ai-conductor/chat'))
  await page.getByRole('textbox', { name: 'Message' }).fill('Make the hero punchier')
  await page.getByRole('button', { name: 'Send' }).click()
  const body = (await chatRequest).postDataJSON() as { context?: { collection: string; id: string } }
  expect(body.context).toMatchObject({ collection: 'pages', id: expect.stringMatching(/^\d+$/) })
})

test('sending without a configured model explains the problem and links to Settings', async ({ page }) => {
  await login(page)
  await page.goto('/admin/ai-conductor')

  await page.getByPlaceholder('Ask AI Conductor to build or edit a page...').fill('Build me a landing page')
  await page.getByRole('button', { name: 'Send' }).click()

  // Scoped by text: Next's route announcer is also a role="alert" region.
  const alert = page.getByRole('alert').filter({ hasText: 'No AI model is configured' })
  await expect(alert).toBeVisible({ timeout: 15_000 })
  await expect(alert.getByRole('link', { name: 'Open AI Conductor Settings' })).toHaveAttribute(
    'href',
    '/admin/globals/ai-conductor-settings',
  )
})

test.describe('composer', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/admin/ai-conductor')
  })

  test('is not resizable and grows with its content up to ~6 lines, then scrolls', async ({ page }) => {
    const textarea = page.getByRole('textbox', { name: 'Message' })
    await expect(textarea).toHaveCSS('resize', 'none')

    const oneLine = (await textarea.boundingBox())!.height
    await textarea.fill('1\n2\n3')
    const threeLines = (await textarea.boundingBox())!.height
    expect(threeLines).toBeGreaterThan(oneLine)

    await textarea.fill(Array.from({ length: 15 }, (_, i) => `line ${i}`).join('\n'))
    const capped = (await textarea.boundingBox())!.height
    await textarea.fill(Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'))
    expect((await textarea.boundingBox())!.height).toBe(capped)
    await expect(textarea).toHaveCSS('overflow-y', 'auto')
  })

  test('Shift+Enter adds a new line; Enter sends; Enter on an empty field does nothing', async ({ page }) => {
    const textarea = page.getByRole('textbox', { name: 'Message' })

    await textarea.press('Enter')
    await expect(page.locator('[class*="bubbleUser"]')).toHaveCount(0)

    await textarea.fill('first line')
    await textarea.press('Shift+Enter')
    await textarea.pressSequentially('second line')
    await expect(textarea).toHaveValue('first line\nsecond line')

    await textarea.press('Enter')
    await expect(textarea).toHaveValue('')
    await expect(page.getByText('second line')).toBeVisible()
  })

  test('sits below the message list instead of covering it', async ({ page }) => {
    const textarea = page.getByRole('textbox', { name: 'Message' })
    const userBubbles = page.locator('[class*="bubbleUser"]')
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await textarea.fill(`message ${n}`)
      await textarea.press('Enter')
      await expect(userBubbles).toHaveCount(n)
      // The turn is over once Stop turns back into Send.
      await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 15_000 })
    }

    const composer = (await page.locator('form:has(textarea[aria-label="Message"])').boundingBox())!
    const lastMessage = (await userBubbles.last().boundingBox())!
    expect(lastMessage.y + lastMessage.height).toBeLessThanOrEqual(composer.y)
  })
})

// The chat stream is replayed from a fixture (no model needed); the preview behind the approval card
// is real — it diffs the proposal against the stored page through the plugin's own endpoint.
test('the approval card shows what an update will change, block by block', async ({ page }) => {
  await login(page)

  const created = await page.request.post('/api/pages', {
    data: {
      title: 'Approval Card Page',
      slug: `approval-card-${Date.now()}`,
      layout: [
        { blockType: 'hero', heading: 'Plain hero' },
        { blockType: 'cta', buttonHref: '/go', buttonLabel: 'Go', heading: 'Call to action' },
      ],
    },
  })
  expect(created.ok()).toBe(true)
  const { doc } = (await created.json()) as { doc: { id: number; layout: Array<{ id: string }> } }
  const heroId = doc.layout[0].id

  const sse = (chunks: unknown[]) =>
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  const streamHeaders = { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' }

  const chatBodies: Array<{ messages: Array<{ parts: Array<Record<string, unknown>> }> }> = []
  await page.route('**/api/plugin/ai-conductor/chat', async (route) => {
    chatBodies.push(route.request().postDataJSON())
    const chunks =
      chatBodies.length === 1
        ? [
            { type: 'start', messageId: 'assistant-1' },
            { type: 'start-step' },
            {
              type: 'tool-input-available',
              input: {
                id: doc.id,
                collection: 'pages',
                operations: [{ blockId: heroId, data: { heading: 'A punchier hero' }, op: 'update' }],
              },
              toolCallId: 'call-apply',
              toolName: 'apply_proposal',
            },
            { type: 'tool-approval-request', approvalId: 'approval-1', toolCallId: 'call-apply' },
            { type: 'finish-step' },
            { type: 'finish', finishReason: 'tool-calls' },
          ]
        : [
            { type: 'start', messageId: 'assistant-1' },
            { type: 'start-step' },
            { type: 'tool-output-available', output: { success: true }, toolCallId: 'call-apply' },
            { type: 'finish-step' },
            { type: 'start-step' },
            { type: 'text-start', id: 't1' },
            { type: 'text-delta', delta: 'Done — the hero is updated.', id: 't1' },
            { type: 'text-end', id: 't1' },
            { type: 'finish-step' },
            { type: 'finish', finishReason: 'stop' },
          ]
    await route.fulfill({ body: sse(chunks), headers: streamHeaders, status: 200 })
  })

  await page.goto(`/admin/ai-conductor?collection=pages&id=${doc.id}`)
  await page.getByRole('textbox', { name: 'Message' }).fill('Make the hero punchier')
  await page.getByRole('textbox', { name: 'Message' }).press('Enter')

  const card = page.getByRole('group', { name: 'Proposed change awaiting approval' })
  await expect(card).toContainText('Update')
  await expect(card).toContainText(`pages #${doc.id}`)
  const heroRow = card.locator('li', { hasText: 'hero' })
  await expect(heroRow).toContainText('Changed')
  await expect(heroRow).toContainText('A punchier hero')
  await expect(heroRow).toContainText('(heading)')
  await expect(card.locator('li', { hasText: 'cta' })).toContainText('Unchanged')

  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Done — the hero is updated.')).toBeVisible()

  const resumed = chatBodies[1].messages.at(-1)!.parts.find((part) => part.type === 'tool-apply_proposal')
  expect(resumed).toMatchObject({ approval: { approved: true }, state: 'approval-responded' })
})
