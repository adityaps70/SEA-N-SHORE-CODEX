import { expect, test } from '@playwright/test'

test('signed-out visitor is redirected from home', async ({ page }) => {
  await page.goto('/home')
  await expect(page).toHaveURL(/\/auth\/sign-in/)
})

test('completed member can open the maritime feed', async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD
  test.skip(!email || !password, 'Set E2E_USER_EMAIL and E2E_USER_PASSWORD to run the authenticated feed smoke test.')

  await page.goto('/auth/sign-in')
  await page.getByLabel('Email').fill(email as string)
  await page.getByLabel('Password').fill(password as string)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/home(?:\?|$)/)
  await expect(page.getByPlaceholder('Share a maritime update, technical lesson, or industry insight...')).toBeVisible()
  await expect(page.getByText('Profile completeness')).toBeVisible()
  await expect(page.getByText(/Verified CoC|Reputation 6,200/i)).toHaveCount(0)
})
