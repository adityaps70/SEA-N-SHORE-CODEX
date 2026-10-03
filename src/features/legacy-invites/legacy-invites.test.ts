import { describe, expect, it, vi } from 'vitest'
import { createLegacyInviteRepository } from './repository'
import { legacyInviteEmail } from './email'
import { createLegacyInviteWorker } from './sending'

describe('legacy profile invitations', () => {
  it('can build worker email without importing the strict browser environment', () => {
    const previous = process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.NEXT_PUBLIC_SITE_URL
    try {
      const email = legacyInviteEmail({
        fullName: 'Worker Test',
        claimToken: '33333333-3333-4333-8333-333333333333',
      })
      expect(email.claimUrl).toBe('https://seanshore.in/auth/claim-profile?invite=33333333-3333-4333-8333-333333333333')
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
      else process.env.NEXT_PUBLIC_SITE_URL = previous
    }
  })

  it('builds an account-reconnection email with a private claim token and no newsletter language', () => {
    const email = legacyInviteEmail({
      fullName: 'Captain Test',
      claimToken: '11111111-1111-4111-8111-111111111111',
      siteUrl: 'https://seanshore.in',
    })
    expect(email.subject).toContain('profile')
    expect(email.claimUrl).toBe('https://seanshore.in/auth/claim-profile?invite=11111111-1111-4111-8111-111111111111')
    expect(email.text).toContain('old password was not moved')
    expect(email.text).toContain('account-reconnection notice')
    expect(email.text.toLowerCase()).not.toContain('subscribe to our newsletter')
  })

  it('prepares bounded eligible batches without putting them directly in the send queue', async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = []
    const repository = createLegacyInviteRepository({
      query: (async (text: string, values: readonly unknown[] = []) => {
        calls.push({ text, values })
        return [{ id: 'i1' }, { id: 'i2' }]
      }) as never,
    })
    await expect(repository.prepareEligible(5000, 'admin-1')).resolves.toBe(2)
    expect(calls[0].values).toEqual(['admin-1', 100])
    expect(calls[0].text).toContain("'prepared'")
    expect(calls[0].text).toContain('claim.claimed_at is null')
    expect(calls[0].text).toContain('count(distinct claim.profile_id) = 1')
    expect(calls[0].text).toContain('identity.email_verified = true')
  })

  it('requires an explicit transition from prepared to queued and supports cancellation/stop', async () => {
    const calls: string[] = []
    const repository = createLegacyInviteRepository({
      query: (async (text: string) => {
        calls.push(text)
        return [{ id: 'i1' }]
      }) as never,
    })
    await expect(repository.startPrepared()).resolves.toBe(1)
    await expect(repository.cancelPrepared()).resolves.toBe(1)
    await expect(repository.stopUnsent()).resolves.toBe(1)
    expect(calls[0]).toContain("where status = 'prepared'")
    expect(calls[0]).toContain("set status = 'queued'")
    expect(calls[1]).toContain("set status = 'cancelled'")
    expect(calls[1]).toContain("where status = 'prepared'")
    expect(calls[2]).toContain("where status in ('queued', 'failed')")
  })

  it('sends through Resend once with a stable idempotency key and skips users no longer eligible', async () => {
    const repository = {
      claimBatch: vi.fn(async () => [
        {
          id: 'invite-1',
          profileId: 'p1',
          email: 'old@example.com',
          fullName: 'Old Member',
          claimToken: '11111111-1111-4111-8111-111111111111',
          attempts: 1,
          stillEligible: true,
        },
        {
          id: 'invite-2',
          profileId: 'p2',
          email: 'claimed@example.com',
          fullName: 'Claimed Member',
          claimToken: '22222222-2222-4222-8222-222222222222',
          attempts: 1,
          stillEligible: false,
        },
      ]),
      markSent: vi.fn(),
      markSkipped: vi.fn(),
      markFailed: vi.fn(),
    }
    const resend = { sendEmail: vi.fn(async () => ({ messageId: 'resend-1' })) }
    const inviteWorker = createLegacyInviteWorker({ repository: repository as never, resend, siteUrl: 'https://seanshore.in' })
    await expect(inviteWorker.runSweep(5)).resolves.toMatchObject({ claimed: 2, sent: 1, skipped: 1, failed: 0 })
    expect(resend.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Sea N Shore <accounts@mail.seanshore.in>',
      to: 'old@example.com',
      idempotencyKey: 'legacy-profile-invite/invite-1',
      tags: [{ name: 'category', value: 'legacy_profile_invite' }],
    }))
    expect(repository.markSent).toHaveBeenCalledWith('invite-1', 'resend-1')
    expect(repository.markSkipped).toHaveBeenCalledWith('invite-2', 'legacy_profile_no_longer_eligible')
  })
})
