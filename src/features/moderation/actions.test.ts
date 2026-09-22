import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  reportContent: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./repository', () => ({
  moderationRepository: { reportContent: mocks.reportContent },
}))

import { reportContent } from './actions'

const targetId = '22222222-2222-4222-8222-222222222222'

describe('content reporting actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'reporter-1' })
    mocks.reportContent.mockResolvedValue(undefined)
  })

  it('validates target-specific reasons before authentication', async () => {
    await expect(reportContent({
      targetType: 'post',
      targetId,
      reason: 'recruitment_fee',
      details: '',
    })).resolves.toMatchObject({ ok: false })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
  })

  it('submits a valid report with the authenticated reporter identity', async () => {
    await expect(reportContent({
      targetType: 'comment',
      targetId,
      reason: 'harassment',
      details: 'Repeated personal attacks.',
    })).resolves.toEqual({ ok: true })

    expect(mocks.reportContent).toHaveBeenCalledWith({
      reporterId: 'reporter-1',
      targetType: 'comment',
      targetId,
      reason: 'harassment',
      details: 'Repeated personal attacks.',
    })
  })

  it('returns safe copy for self reports and unavailable content', async () => {
    mocks.reportContent.mockRejectedValueOnce(new Error('moderation_self_report_forbidden'))
    await expect(reportContent({
      targetType: 'event',
      targetId,
      reason: 'misinformation',
      details: '',
    })).resolves.toEqual({ ok: false, error: 'You cannot report your own content.' })

    mocks.reportContent.mockRejectedValueOnce(new Error('moderation_target_unavailable'))
    await expect(reportContent({
      targetType: 'post',
      targetId,
      reason: 'spam',
      details: '',
    })).resolves.toEqual({ ok: false, error: 'This content is no longer available to report.' })
  })
})
