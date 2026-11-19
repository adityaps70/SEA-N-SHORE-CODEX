import { describe, expect, it, vi } from 'vitest'
import { organizationReviewMessage } from '@/features/notifications/queries'
import { ResendApiError } from '@/lib/email/resend'
import { ORGANIZATION_REVIEW_EMAIL_FROM, organizationReviewSiteUrl, renderOrganizationReviewEmail } from './organization-review-email'
import { createOrganizationReviewEmailSweep, createOrganizationReviewEmailWorker, type OrganizationReviewEmailDelivery } from './organization-review-email-sending'

/** Round GP (Part C): the applicant's email and in-app notice when an organization is reviewed. Placeholder data. */
const site = 'https://staging.placeholder.example'
const details = (decision: 'approved' | 'rejected' | 'changes_requested', reason: string | null = null) => ({
  decision, companyName: 'Placeholder <Harbour> Crew', companySlug: 'placeholder-harbour-crew', reason,
})

describe('organization review email', () => {
  it('builds every link from the site address setting, never a fixed domain', () => {
    expect(organizationReviewSiteUrl('https://staging.placeholder.example/')).toBe(site)
    expect(organizationReviewSiteUrl('')).toBeNull()
    expect(organizationReviewSiteUrl(undefined)).toBe(organizationReviewSiteUrl(process.env.NEXT_PUBLIC_SITE_URL))
    expect(organizationReviewSiteUrl('not a url')).toBeNull()
    const approved = renderOrganizationReviewEmail({ details: details('approved'), siteUrl: site })
    expect(approved.text).toContain(`${site}/organizations/placeholder-harbour-crew`)
    const rejected = renderOrganizationReviewEmail({ details: details('rejected', 'Placeholder reason.'), siteUrl: site })
    expect(rejected.text).toContain(`${site}/organizations#update-application`)
    for (const email of [approved, rejected]) {
      expect(`${email.text}${email.html}`).not.toMatch(/seanshore\.(in|net|com)/)
    }
    expect(ORGANIZATION_REVIEW_EMAIL_FROM).toMatch(/@mail\.seanshore\.in>$/)
  })

  it('says what was decided, and includes the reason for a rejection or a request for changes', () => {
    expect(renderOrganizationReviewEmail({ details: details('approved'), siteUrl: site }).subject).toBe('Placeholder <Harbour> Crew is verified on Sea N Shore')
    const changes = renderOrganizationReviewEmail({ details: details('changes_requested', 'Add the <registration> number.'), siteUrl: site })
    expect(changes.subject).toBe('Changes needed to verify Placeholder <Harbour> Crew')
    expect(changes.text).toContain('The reviewer wrote:\nAdd the <registration> number.')
    expect(changes.html).toContain('Add the &lt;registration&gt; number.')
    expect(changes.html).not.toContain('<Harbour>')
    expect(renderOrganizationReviewEmail({ details: details('rejected', 'Placeholder reason.'), siteUrl: site }).text).toContain('Placeholder reason.')
    expect(renderOrganizationReviewEmail({ details: details('approved'), siteUrl: site }).text).not.toContain('reviewer wrote')
  })

  it('keeps a line break in the organization name out of the subject', () => {
    expect(renderOrganizationReviewEmail({ details: { ...details('approved'), companyName: 'Placeholder\r\nBcc: x' }, siteUrl: site }).subject).not.toMatch(/[\r\n]/)
  })

  it('gives the in-app notice the same decision', () => {
    expect(organizationReviewMessage(details('approved'))).toBe('Sea N Shore verified Placeholder <Harbour> Crew. Its page is now public.')
    expect(organizationReviewMessage(details('rejected'))).toBe('Sea N Shore could not verify Placeholder <Harbour> Crew. See the reason and resubmit.')
    expect(organizationReviewMessage(details('changes_requested'))).toBe('Sea N Shore needs changes before it can verify Placeholder <Harbour> Crew.')
    expect(organizationReviewMessage(null)).toBe('Sea N Shore reviewed your organization.')
  })
})

function fakeRepository(deliveries: OrganizationReviewEmailDelivery[]) {
  return {
    claimBatch: vi.fn(async () => deliveries),
    markSent: vi.fn(async () => undefined),
    markSkipped: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    tableReady: vi.fn(async () => true),
  }
}

const delivery = (overrides: Partial<OrganizationReviewEmailDelivery> = {}): OrganizationReviewEmailDelivery => ({
  id: 'row-1', details: details('approved'), email: 'applicant@placeholder.example', stale: false, ...overrides,
})

describe('organization review email worker', () => {
  it('sends once per row with an idempotency key, and skips stale rows and members without a verified email', async () => {
    const repository = fakeRepository([delivery(), delivery({ id: 'row-2', stale: true }), delivery({ id: 'row-3', email: null })])
    const sendEmail = vi.fn(async () => ({ messageId: 'message-1' }))
    const worker = createOrganizationReviewEmailWorker({ repository: repository as never, resend: { sendEmail } as never, siteUrl: site })
    expect(await worker.runSweep()).toEqual({ claimed: 3, sent: 1, failed: 0, skipped: 2, retrying: 0, disabled: false })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ from: ORGANIZATION_REVIEW_EMAIL_FROM, idempotencyKey: 'organization-review-email/row-1' }))
    expect(repository.markSent).toHaveBeenCalledWith('row-1', 'message-1')
    expect(repository.markSkipped.mock.calls).toEqual([['row-2', 'stale'], ['row-3', 'no_verified_email']])
  })

  it('claims nothing without a Resend key or a site address', async () => {
    for (const options of [{ resend: null, siteUrl: site }, { resend: { sendEmail: vi.fn() }, siteUrl: null }]) {
      const repository = fakeRepository([delivery()])
      const worker = createOrganizationReviewEmailWorker({ repository: repository as never, ...options } as never)
      expect(await worker.runSweep()).toMatchObject({ claimed: 0, disabled: true })
      expect(repository.claimBatch).not.toHaveBeenCalled()
    }
  })

  it('stops the pass on a retryable error and marks it for retry', async () => {
    const repository = fakeRepository([delivery(), delivery({ id: 'row-2' })])
    const sendEmail = vi.fn(async () => { throw new ResendApiError('rate_limit_exceeded', 429, 'Too many requests') })
    const worker = createOrganizationReviewEmailWorker({ repository: repository as never, resend: { sendEmail } as never, siteUrl: site })
    expect(await worker.runSweep()).toMatchObject({ claimed: 2, sent: 0, retrying: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(repository.markFailed).toHaveBeenCalledWith('row-1', expect.any(String), true)
  })

  it('waits quietly until the queue table exists (migration 0110), checking every 10 minutes', async () => {
    let clock = 0
    const repository = fakeRepository([])
    repository.tableReady.mockResolvedValue(false)
    const worker = { runSweep: vi.fn(async () => ({ claimed: 0 })) }
    const sweep = createOrganizationReviewEmailSweep({ repository: repository as never, worker: worker as never, now: () => clock })
    expect(await sweep.run()).toBeUndefined()
    clock += 60_000
    expect(await sweep.run()).toBeUndefined()
    expect(repository.tableReady).toHaveBeenCalledTimes(1)
    clock += 10 * 60_000
    repository.tableReady.mockResolvedValue(true)
    await sweep.run()
    expect(worker.runSweep).toHaveBeenCalledTimes(1)
  })
})
