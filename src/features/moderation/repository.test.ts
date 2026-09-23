import { describe, expect, it } from 'vitest'
import { createModerationRepository } from './repository'

const reporterId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'

describe('content reporting repository', () => {
  it('rejects self-reporting before creating a report', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createModerationRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('from public.posts')) return [{ owner_id: reporterId }]
        return []
      },
    })

    await expect(repository.reportContent({
      reporterId,
      targetType: 'post',
      targetId,
      reason: 'spam',
      details: null,
    })).rejects.toThrow('moderation_self_report_forbidden')

    expect(seen.some((entry) => entry.text.includes('insert into public.content_reports'))).toBe(false)
  })

  it('upserts one open case per reporter and target after confirming the target is reportable', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createModerationRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('from public.events')) return [{ owner_id: '33333333-3333-4333-8333-333333333333' }]
        return []
      },
    })

    await repository.reportContent({
      reporterId,
      targetType: 'event',
      targetId,
      reason: 'misinformation',
      details: 'The venue details are misleading.',
    })

    const insert = seen.find((entry) => entry.text.includes('insert into public.content_reports'))
    expect(insert?.text).toContain('on conflict (target_type, target_id, reporter_id)')
    expect(insert?.text).toContain("status = 'open'")
    expect(insert?.values).toEqual([
      'event',
      targetId,
      reporterId,
      'misinformation',
      'The venue details are misleading.',
    ])
  })

  it('stores copyright complaints compatibly while preserving a clear admin marker', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createModerationRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('from public.posts')) return [{ owner_id: '33333333-3333-4333-8333-333333333333' }]
        return []
      },
    })

    await repository.reportContent({
      reporterId,
      targetType: 'post',
      targetId,
      reason: 'copyright_infringement',
      details: 'I own the original image and this post reproduces it without permission.',
    })

    const insert = seen.find((entry) => entry.text.includes('insert into public.content_reports'))
    expect(insert?.values).toEqual([
      'post',
      targetId,
      reporterId,
      'other',
      '[COPYRIGHT/IP COMPLAINT]\nI own the original image and this post reproduces it without permission.',
    ])
  })

  it('accepts reports for another member profile and uses the profile as the report owner', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createModerationRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('from public.profiles')) return [{ owner_id: '33333333-3333-4333-8333-333333333333' }]
        return []
      },
    })

    await repository.reportContent({
      reporterId,
      targetType: 'profile',
      targetId,
      reason: 'fake_profile',
      details: 'The profile appears to use invented credentials and identity details.',
    })

    expect(seen[0]?.text).toContain('from public.profiles')
    expect(seen.find((entry) => entry.text.includes('insert into public.content_reports'))?.values).toEqual([
      'profile',
      targetId,
      reporterId,
      'fake_profile',
      'The profile appears to use invented credentials and identity details.',
    ])
  })

  it('fails closed when the target is unavailable', async () => {
    const repository = createModerationRepository({ query: async () => [] })

    await expect(repository.reportContent({
      reporterId,
      targetType: 'comment',
      targetId,
      reason: 'harassment',
      details: null,
    })).rejects.toThrow('moderation_target_unavailable')
  })
})
