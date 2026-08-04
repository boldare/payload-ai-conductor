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
  await expect(page.getByText('pages', { exact: false })).toBeVisible()
})

test('sending a message without a configured model surfaces an error instead of hanging silently', async ({
  page,
}) => {
  await login(page)
  await page.goto('/admin/ai-conductor')

  await page.getByPlaceholder('Ask AI Conductor to build or edit a page...').fill('Build me a landing page')
  await page.click('button:has-text("Send")')

  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
})
