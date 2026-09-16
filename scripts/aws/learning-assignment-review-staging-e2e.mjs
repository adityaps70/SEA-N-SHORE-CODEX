import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const siteUrl = process.env.SITE_URL
const phase = process.env.E2E_PHASE
const runId = process.env.GITHUB_RUN_ID
const courseTitle = process.env.E2E_COURSE_TITLE
const courseSlug = process.env.E2E_COURSE_SLUG
const feedback = process.env.E2E_FEEDBACK

const users = {
  mentor: {
    email: process.env.E2E_MENTOR_EMAIL,
    password: process.env.E2E_MENTOR_PASSWORD,
    fullName: process.env.E2E_MENTOR_NAME,
  },
  learner: {
    email: process.env.E2E_LEARNER_EMAIL,
    password: process.env.E2E_LEARNER_PASSWORD,
    fullName: process.env.E2E_LEARNER_NAME,
  },
}

assert.ok(siteUrl, 'SITE_URL is required')
assert.ok(runId, 'GITHUB_RUN_ID is required')
assert.ok(courseTitle && courseSlug && feedback, 'Course fixture metadata is required')
assert.ok(['signup', 'onboarding', 'learner-submit', 'mentor-review', 'learner-verify'].includes(phase), 'Unsupported E2E_PHASE')
for (const [key, user] of Object.entries(users)) {
  assert.match(user.email ?? '', new RegExp(`^sea-n-shore-learning-review-e2e-[0-9]+-${key}@example\\.com$`))
  assert.ok((user.password ?? '').length >= 12)
  assert.ok(user.fullName)
}

const browser = await chromium.launch()

async function signUp(user) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${siteUrl}/auth/sign-up`, { waitUntil: 'networkidle' })
  await page.getByLabel('Full name').fill(user.fullName)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL((url) => url.pathname === '/auth/sign-up' && url.searchParams.get('confirm') === '1', { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible()
  await context.close()
}

async function signInForOnboarding(page, user) {
  await page.goto(`${siteUrl}/auth/sign-in`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/onboarding', { timeout: 20_000 })
}

async function signInCompleted(page, user) {
  await page.goto(`${siteUrl}/auth/sign-in`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
}

async function completeProfessional(user, suffix) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInForOnboarding(page, user)
  await page.getByRole('button', { name: /Professional Build your individual maritime identity/ }).click()
  await page.getByLabel('Search professional identities').fill('Master')
  await page.getByRole('button', { name: 'Master — Sea-going · Deck' }).click()
  await expect(page.locator('[data-primary-identity="true"]')).toHaveText('Master')
  await page.getByLabel('Profile address').fill(`sns-learning-review-${suffix}-${runId}`)
  await page.getByLabel('Location').fill('Mumbai')
  await page.getByLabel('Current organisation').fill('Sea N Shore E2E')
  await page.getByRole('button', { name: 'Complete profile' }).click()
  await page.waitForURL((url) => url.pathname === '/home', { timeout: 20_000 })
  await context.close()
}

async function learnerSubmit() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.learner)
  await page.goto(`${siteUrl}/learn/courses/${courseSlug}`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: courseTitle })).toBeVisible()
  const enrollButton = page.getByRole('button', { name: 'Enroll free' })
  if (await enrollButton.isVisible()) await enrollButton.click()
  await expect(page.getByText('You are enrolled in this course.')).toBeVisible({ timeout: 20_000 })

  await page.goto(`${siteUrl}/learn/courses/${courseSlug}/learn`, { waitUntil: 'networkidle' })
  const lockedNext = page.getByRole('link', { name: /Unlocked after mentor pass/ })
  await expect(lockedNext).toContainText('Locked')
  await page.getByLabel('Your response').fill('E2E learner response with clear preparation evidence, controls and verification steps.')
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await expect(page.getByText('Awaiting mentor review')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Progress unlocks only after a passing grade/)).toBeVisible()
  await context.close()
}

async function mentorReview() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.mentor)
  await page.goto(`${siteUrl}/learn/studio`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Mentor Studio' })).toBeVisible()
  await expect(page.getByText('Learner reviews', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '1 learner submission needs your review' })).toBeVisible()
  console.log('Pending learner reviews verified via Mentor Studio learner review metric and banner.')
  await page.getByRole('link', { name: /Review assignments/ }).first().click()
  await page.waitForURL((url) => url.pathname === '/learn/studio/assignments', { timeout: 20_000 })
  await expect(page.getByText('1 awaiting review', { exact: true })).toBeVisible()

  const pendingCard = page.locator('article').filter({ hasText: courseTitle }).filter({ hasText: users.learner.fullName }).first()
  await expect(pendingCard).toContainText('E2E evidence assignment')
  await expect(pendingCard).toContainText('Pending')
  await pendingCard.getByRole('link', { name: `Review ${users.learner.fullName} submission` }).click()

  await expect(page.getByRole('heading', { name: 'E2E evidence assignment' })).toBeVisible()
  await expect(page.getByText('Explain how you would verify safe preparation before starting the task. Include clear evidence and controls.')).toBeVisible()
  await expect(page.getByText('E2E learner response with clear preparation evidence, controls and verification steps.')).toBeVisible()
  await page.getByLabel('Score / 100').fill('85')
  await page.getByLabel('Feedback').fill(feedback)
  await page.getByRole('button', { name: 'Pass' }).click()
  await expect(page.getByText('Published grade')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Passed', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(feedback, { exact: true })).toBeVisible()

  await page.goto(`${siteUrl}/learn/studio/assignments`, { waitUntil: 'networkidle' })
  await expect(page.getByText('0 awaiting review', { exact: true })).toBeVisible()
  await context.close()
}

async function learnerVerify() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInCompleted(page, users.learner)
  await page.goto(`${siteUrl}/learn/courses/${courseSlug}/learn`, { waitUntil: 'networkidle' })

  const assignmentLink = page.getByRole('link', { name: /E2E evidence assignment/ })
  await assignmentLink.click()
  await expect(page.getByText('Assignment passed and material completed.')).toBeVisible()
  await expect(page.getByText(`Mentor feedback: ${feedback}`, { exact: true })).toBeVisible()

  const unlockedNext = page.getByRole('link', { name: /Unlocked after mentor pass/ })
  await expect(unlockedNext).not.toContainText('Locked')
  await unlockedNext.click()
  await expect(page.getByRole('heading', { name: 'Unlocked after mentor pass' })).toBeVisible()
  console.log('Unlocked after mentor pass')
  await context.close()
}

try {
  if (phase === 'signup') {
    await signUp(users.mentor)
    await signUp(users.learner)
  } else if (phase === 'onboarding') {
    await completeProfessional(users.mentor, 'mentor')
    await completeProfessional(users.learner, 'learner')
  } else if (phase === 'learner-submit') {
    await learnerSubmit()
  } else if (phase === 'mentor-review') {
    await mentorReview()
  } else if (phase === 'learner-verify') {
    await learnerVerify()
  }
} finally {
  await browser.close()
}
