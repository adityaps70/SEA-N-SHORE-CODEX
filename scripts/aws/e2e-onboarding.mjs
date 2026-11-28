/**
 * Shared onboarding choices for the staging browser E2Es. Each one matches the persona onboarding in
 * src/features/profiles/components/onboarding-form.tsx (personas and intents in src/features/profiles/persona.ts,
 * department and rank keys in src/features/roles/taxonomy.ts). The retired Professional / Organisation root cards and
 * their identity search are gone. The callers keep their own username, location and completion steps.
 *
 * Desktop viewport only: on phones onboarding goes one step at a time behind Continue buttons.
 */
export const SEAFARER_MASTER = Object.freeze({
  persona: 'Seafarer',
  intent: 'Find jobs',
  organisationLabel: 'Current / last organisation',
  departmentLabel: 'Department',
  department: 'deck_officers',
  rankLabel: 'Current or most recent rank',
  rank: 'master',
})

/** On /onboarding: Seafarer → Find jobs → Deck officers / Master, with the organisation typed as free text. */
export async function chooseSeafarerMaster(page, { organisation } = {}) {
  if (typeof organisation !== 'string' || !organisation.trim()) {
    throw new Error('chooseSeafarerMaster needs the organisation to type into Current / last organisation')
  }
  // Loaded here, not at the top, so its contract test runs in CI jobs that do not install node_modules.
  const { expect } = await import('@playwright/test')

  const persona = page.getByRole('button', { name: SEAFARER_MASTER.persona, exact: true })
  await persona.click()
  await expect(persona).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('What are you here to do?', { exact: true })).toBeVisible()

  const intent = page.getByRole('button', { name: SEAFARER_MASTER.intent, exact: true })
  await intent.click()
  await expect(intent).toHaveAttribute('aria-pressed', 'true')

  await page.getByLabel(SEAFARER_MASTER.organisationLabel, { exact: true }).fill(organisation)
  // The rank picker stays disabled until a department is chosen.
  await page.getByLabel(SEAFARER_MASTER.departmentLabel, { exact: true }).selectOption(SEAFARER_MASTER.department)
  const rank = page.getByLabel(SEAFARER_MASTER.rankLabel, { exact: true })
  await rank.selectOption(SEAFARER_MASTER.rank)
  await expect(rank).toHaveValue(SEAFARER_MASTER.rank)
}
