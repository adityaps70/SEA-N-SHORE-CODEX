import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { ResendApiError } from '@/lib/email/resend'
import { getNewsletterConfig } from './config'
import { createNewsletterSender } from './sending'

const enabledEnv = {
  NEWSLETTER_TOKEN_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  NEWSLETTER_FROM_ADDRESS: 'Sea N Shore <newsletter@mail.seanshore.in>',
  NEXT_PUBLIC_SITE_URL: 'https://seanshore.example',
}

const repository = {
  claimConfirmation: vi.fn(),
  claimPendingConfirmations: vi.fn(),
  clearConfirmationSent: vi.fn(),
  createCampaign: vi.fn(),
  claimDeliveries: vi.fn(),
  markDelivery: vi.fn(),
  finalizeCampaigns: vi.fn(),
}

const resend = { sendEmail: vi.fn(async () => ({ messageId: 'msg-1' })) }

const delivery = {
  campaignId: 'c1',
  subscriberId: '11111111-1111-4111-8111-111111111111',
  email: 'crew@example.com',
  topic: 'jobs_digest' as const,
  subject: 'New vacancies',
  bodyText: 'Hello crew.\n\nNew jobs are live.',
  stillSubscribed: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('newsletter sending through Resend', () => {
  it('stays disabled until the Resend API key/client is available', async () => {
    const sender = createNewsletterSender({ repository, resend: null, config: getNewsletterConfig(enabledEnv) })

    await expect(sender.sendingStatus()).resolves.toEqual({ enabled: false, reason: 'resend_api_key' })
    await expect(sender.queueCampaign({ adminId: 'a', topic: 'jobs_digest', subject: 'Hi', bodyText: 'Hello there' }))
      .rejects.toThrow('newsletter_sending_disabled')
    await expect(sender.runCampaignSweep()).resolves.toEqual({ claimed: 0, sent: 0, failed: 0, skipped: 0 })
    await expect(sender.sendConfirmation('x')).resolves.toBe('disabled')
    expect(resend.sendEmail).not.toHaveBeenCalled()
  })

  it('sends campaign mail through Resend with one-click unsubscribe and an idempotency key', async () => {
    repository.claimDeliveries.mockResolvedValue([delivery])
    const config = getNewsletterConfig(enabledEnv)
    expect(config.listUnsubscribeMode).toBe('app')
    const sender = createNewsletterSender({ repository, resend, config })

    await expect(sender.sendingStatus()).resolves.toEqual({ enabled: true })
    await expect(sender.runCampaignSweep()).resolves.toEqual({ claimed: 1, sent: 1, failed: 0, skipped: 0 })

    const sent = (resend.sendEmail.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(sent).toMatchObject({
      to: 'crew@example.com',
      from: 'Sea N Shore <newsletter@mail.seanshore.in>',
      idempotencyKey: 'newsletter-campaign/c1/11111111-1111-4111-8111-111111111111',
      tags: [{ name: 'category', value: 'newsletter_campaign' }],
    })
    expect(sent.text).toContain('https://seanshore.example/newsletter/unsubscribe?token=')
    expect(sent.headers).toEqual([
      { Name: 'List-Unsubscribe', Value: expect.stringMatching(/^<https:\/\/seanshore\.example\/api\/newsletter\/unsubscribe\?token=.+>$/) },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ])
    expect(repository.markDelivery).toHaveBeenCalledWith(delivery, { status: 'sent', messageId: 'msg-1' })
    expect(repository.finalizeCampaigns).toHaveBeenCalled()
  })

  it('skips recipients who unsubscribed after queueing and requeues Resend throttling', async () => {
    repository.claimDeliveries.mockResolvedValue([{ ...delivery, stillSubscribed: false }, delivery, { ...delivery, subscriberId: 'other' }])
    resend.sendEmail.mockRejectedValueOnce(new ResendApiError('rate_limit_exceeded', 429, 'slow down'))
    const sender = createNewsletterSender({ repository, resend, config: getNewsletterConfig(enabledEnv) })

    await expect(sender.runCampaignSweep()).resolves.toEqual({ claimed: 3, sent: 0, failed: 0, skipped: 1 })
    expect(repository.markDelivery).toHaveBeenNthCalledWith(1, expect.objectContaining({ stillSubscribed: false }), { status: 'skipped' })
    expect(repository.markDelivery).toHaveBeenNthCalledWith(2, delivery, { status: 'queued', error: 'rate_limit_exceeded: slow down' })
    expect(resend.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('releases a confirmation claim when Resend cannot send so the worker retries', async () => {
    repository.claimConfirmation.mockResolvedValue({
      id: 's1',
      email: 'crew@example.com',
      topics: ['product_updates'],
      updatedAt: '2026-10-01T10:00:00.000Z',
    })
    resend.sendEmail.mockRejectedValueOnce(new Error('network down'))
    const sender = createNewsletterSender({ repository, resend, config: getNewsletterConfig(enabledEnv) })

    await expect(sender.sendConfirmation('s1')).resolves.toBe('failed')
    expect(repository.clearConfirmationSent).toHaveBeenCalledWith('s1')
    expect(resend.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'newsletter-confirmation/s1/2026-10-01',
      tags: [{ name: 'category', value: 'newsletter_confirmation' }],
    }))
  })
})
