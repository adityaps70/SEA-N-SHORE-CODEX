import { expect } from '@playwright/test'

// The onboarding form as it is now: eight role cards (each card's button is named by its label,
// #592), then "What are you here to do?", then the role's own fields. The older "Professional ->
// Master — Sea-going · Deck" path is gone, so the realtime, events, learning-review and hiring
// E2Es answer as a Seafarer who is a Master in the deck department: the same person as before.
// The onboarding E2E (onboarding-staging-e2e.mjs) checks every role card in depth; this helper only
// gets a disposable member through onboarding. Each script still fills its own username.
export async function chooseSeafarerMaster(page, { organisation, location = 'Mumbai' }) {
  const card = page.getByRole('button', { name: 'Seafarer', exact: true })
  await card.click()
  await expect(card).toHaveAttribute('aria-pressed', 'true')
  const intent = page.getByRole('button', { name: 'Find jobs', exact: true })
  await intent.click()
  await expect(intent).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Location', { exact: true }).fill(location)
  await page.getByLabel('Current / last organisation', { exact: true }).fill(organisation)
  await page.getByLabel('Department', { exact: true }).selectOption('deck_officers')
  await page.getByLabel('Current or most recent rank', { exact: true }).selectOption('master')
}
