import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { getNewsletterConfig, newsletterSendingStatus, SENDING_DISABLED_MESSAGES } from './config'
import { SesApiError } from './ses-client'
import { createNewsletterSender } from './sending'

const enabledEnv = {
  NEWSLETTER_TOKEN_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  NEWSLETTER_SES_CONTACT_LIST: 'sea-n-shore-newsletter',
  NEWSLETTER_FROM_ADDRESS: 'Sea N Shore <newsletter@example.com>',
  NEWSLETTER_SES_PRODUCTION_ACCESS: 'true',
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
const ses = { sendEmail: vi.fn(async () => ({ messageId: 'msg-1' })) }

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

describe('newsletter sending', () => {
  it('stays disabled with a clear reason until SES production access is configured', async () => {
    const config = getNewsletterConfig({ ...enabledEnv, NEWSLETTER_SES_PRODUCTION_ACCESS: '' })
    expect(newsletterSendingStatus(config)).toEqual({ enabled: false, reason: 'production_access' })
    expect(SENDING_DISABLED_MESSAGES.production_access).toMatch(/production access/)

    const sender = createNewsletterSender({ repository, ses, config })
    await expect(sender.queueCampaign({ adminId: 'a', topic: 'jobs_digest', subject: 'Hi', bodyText: 'Hello there' })).rejects.toThrow('newsletter_sending_disabled')
    await expect(sender.runCampaignSweep()).resolves.toEqual({ claimed: 0, sent: 0, failed: 0, skipped: 0 })
    await expect(sender.sendConfirmation('x')).resolves.toBe('disabled')
    expect(ses.sendEmail).not.toHaveBeenCalled()
  })

  it('sends campaign mail through SES with list management and an unsubscribe link', async () => {
    repository.claimDeliveries.mockResolvedValue([delivery])
    const sender = createNewsletterSender({ repository, ses, config: getNewsletterConfig(enabledEnv) })

    await expect(sender.runCampaignSweep()).resolves.toEqual({ claimed: 1, sent: 1, failed: 0, skipped: 0 })

    const sent = (ses.sendEmail.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(sent).toMatchObject({
      to: 'crew@example.com',
      from: 'Sea N Shore <newsletter@example.com>',
      listManagement: { contactListName: 'sea-n-shore-newsletter', topicName: 'jobs-digest' },
    })
    expect(sent.text).toContain('https://seanshore.example/newsletter/unsubscribe?token=')
    expect(sent.headers).toEqual([])
    expect(repository.markDelivery).toHaveBeenCalledWith(delivery, { status: 'sent', messageId: 'msg-1' })
    expect(repository.finalizeCampaigns).toHaveBeenCalled()
  })

  it('adds RFC 8058 one-click headers itself in "app" unsubscribe mode', async () => {
    repository.claimDeliveries.mockResolvedValue([delivery])
    const sender = createNewsletterSender({ repository, ses, config: getNewsletterConfig({ ...enabledEnv, NEWSLETTER_LIST_UNSUBSCRIBE: 'app' }) })
    await sender.runCampaignSweep()
    const sent = (ses.sendEmail.mock.calls[0] as unknown[])[0] as { headers: Array<{ Name: string; Value: string }>; listManagement?: unknown }
    expect(sent.listManagement).toBeUndefined()
    expect(sent.headers).toEqual([
      { Name: 'List-Unsubscribe', Value: expect.stringMatching(/^<https:\/\/seanshore\.example\/api\/newsletter\/unsubscribe\?token=.+>$/) },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ])
  })

  it('skips recipients who unsubscribed after the campaign was queued and requeues on throttling', async () => {
    repository.claimDeliveries.mockResolvedValue([{ ...delivery, stillSubscribed: false }, delivery, { ...delivery, subscriberId: 'other' }])
    ses.sendEmail.mockRejectedValueOnce(new SesApiError('TooManyRequestsException', 429, 'slow down'))
    const sender = createNewsletterSender({ repository, ses, config: getNewsletterConfig(enabledEnv) })

    await expect(sender.runCampaignSweep()).resolves.toEqual({ claimed: 3, sent: 0, failed: 0, skipped: 1 })
    expect(repository.markDelivery).toHaveBeenNthCalledWith(1, expect.objectContaining({ stillSubscribed: false }), { status: 'skipped' })
    expect(repository.markDelivery).toHaveBeenNthCalledWith(2, delivery, { status: 'queued', error: 'TooManyRequestsException: slow down' })
    expect(ses.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('releases a confirmation claim when the email cannot be sent so the worker retries', async () => {
    repository.claimConfirmation.mockResolvedValue({ id: 's1', email: 'crew@example.com', topics: ['product_updates'] })
    ses.sendEmail.mockRejectedValueOnce(new Error('network down'))
    const sender = createNewsletterSender({ repository, ses, config: getNewsletterConfig(enabledEnv) })
    await expect(sender.sendConfirmation('s1')).resolves.toBe('failed')
    expect(repository.clearConfirmationSent).toHaveBeenCalledWith('s1')
  })
})
