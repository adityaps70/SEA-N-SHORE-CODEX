import { expect, test } from '@playwright/test'

async function signIn(page: Parameters<typeof test>[0] extends never ? never : any) {
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD
  test.skip(!email || !password, 'Set E2E_USER_EMAIL and E2E_USER_PASSWORD to run authenticated network smoke tests.')

  await page.goto('/auth/sign-in')
  await page.getByLabel('Email').fill(email as string)
  await page.getByLabel('Password').fill(password as string)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/home(?:\?|$)/)
}

test('signed-out visitor is redirected from network', async ({ page }) => {
  await page.goto('/network')
  await expect(page).toHaveURL(/\/auth\/sign-in/)
})

test('completed member can open all My Network states', async ({ page }) => {
  await signIn(page)
  await page.goto('/network')

  await expect(page.getByRole('heading', { name: /People worth knowing at sea and ashore/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Discover$/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Connections$/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Requests/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Following$/i })).toBeVisible()
  await expect(page.getByText(/Capt\. Aarav Sen|Ananya Rao|C\/E Rohan Menon|Capt\. Kabir Malhotra/i).first()).toBeVisible()

  await page.getByRole('link', { name: /Requests/i }).click()
  await expect(page).toHaveURL(/\/network\?tab=requests/)
  await expect(page.getByRole('heading', { name: /Requests for you/i })).toBeVisible()
})

test('notification centre and responsive network navigation are reachable', async ({ page }, testInfo) => {
  await signIn(page)

  if (testInfo.project.name === 'mobile-safari') {
    await expect(page.getByRole('link', { name: 'Notifications' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Network' })).toBeVisible()
  } else {
    await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'My Network' })).toBeVisible()
  }

  await page.goto('/notifications')
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
  await expect(page.getByText(/connection request|accepted your connection request|started following you/i).first()).toBeVisible()
})
