import { describe, expect, it } from 'vitest'
import { createAdminRepository } from './repository'

const adminId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'

const moderationRow = {
  target_type: 'post',
  target_id: targetId,
  target_title: 'Post by Capt. Rahul',
  target_excerpt: 'Suspicious recruitment message asking for money.',
  owner_id: '33333333-3333-4333-8333-333333333333',
  owner_name: 'Capt. Rahul',
  owner_slug: 'capt-rahul',
  target_state: 'visible',
  report_count: '3',
  first_reported_at: '2026-09-21T08:00:00.000Z',
  latest_reported_at: '2026-09-21T10:00:00.000Z',
  reasons: ['spam', 'scam'],
  latest_details: 'Asked users to transfer money.',
}

describe('platform moderation repository', () => {
  it('loads an aggregated report queue only after administrator authorization', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('public.user_roles')) return [{ allowed: true }]
        return [moderationRow]
      },
    })

    await expect(repository.listModerationCases(adminId, {
      status: 'open',
      targetType: 'all',
      limit: 50,
    })).resolves.toEqual([{
      targetType: 'post',
      targetId,
      title: 'Post by Capt. Rahul',
      excerpt: 'Suspicious recruitment message asking for money.',
      owner: { id: moderationRow.owner_id, fullName: 'Capt. Rahul', slug: 'capt-rahul' },
      targetState: 'visible',
      reportCount: 3,
      firstReportedAt: moderationRow.first_reported_at,
      latestReportedAt: moderationRow.latest_reported_at,
      reasons: ['spam', 'scam'],
      latestDetails: 'Asked users to transfer money.',
    }])

    expect(seen[1]?.text).toContain('public.content_reports')
    expect(seen[1]?.text).toContain('count(*)::int as report_count')
    expect(seen[1]?.text).toContain('group by')
    expect(seen[1]?.text).toContain("[COPYRIGHT/IP COMPLAINT]%")
    expect(seen[1]?.text).toContain('where cr.status = $1')
    expect(seen[1]?.text).toContain('limit $2')
    expect(seen[1]?.values).toEqual(['open', 50])
  })

  it('binds content type and limit parameters instead of interpolating invalid SQL literals', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('public.user_roles')) return [{ allowed: true }]
        return [moderationRow]
      },
    })

    await repository.listModerationCases(adminId, {
      status: 'reviewing',
      targetType: 'job',
      limit: 25,
    })

    expect(seen[1]?.text).toContain('where cr.status = $1 and cr.target_type = $2')
    expect(seen[1]?.text).toContain('limit $3')
    expect(seen[1]?.values).toEqual(['reviewing', 'job', 25])
  })

  it('removes a reported post, resolves its active reports, and writes moderation plus audit history atomically', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.content_reports') && text.includes('for update')) {
        return [{ id: 'report-1', status: 'open' }]
      }
      if (text.includes('from public.posts') && text.includes('for update')) {
        return [{ state: 'visible' }]
      }
      return []
    }

    const repository = createAdminRepository({
      query,
      transaction: async (work) => work(query),
    })

    await expect(repository.moderateContent(adminId, {
      targetType: 'post',
      targetId,
      action: 'remove',
      note: 'Recruitment scam.',
    })).resolves.toBe(true)

    const postRemoval = seen.find((entry) => entry.text.includes('update public.posts') && entry.text.includes('deleted_at'))
    expect(postRemoval?.text).toMatch(/deleted_by = \$2/i)
    expect(postRemoval?.text).toMatch(/deletion_reason = \$3/i)
    expect(postRemoval?.text).toMatch(/purge_after = coalesce\(purge_after, now\(\) \+ interval '30 days'\)/i)
    expect(postRemoval?.values).toEqual([targetId, adminId, 'Recruitment scam.'])
    expect(seen.some((entry) => entry.text.includes('update public.content_reports') && entry.text.includes('status = $3') && entry.values?.includes('resolved'))).toBe(true)
    expect(seen.some((entry) => entry.text.includes('insert into public.moderation_actions'))).toBe(true)
    expect(seen.find((entry) => entry.text.includes('insert into public.audit_events'))?.values).toContain('moderation.content_removed')
  })

  it('does not restore content that was not removed by moderation', async () => {
    const query = async (text: string) => {
      if (text.includes('public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.content_reports') && text.includes('for update')) return [{ id: 'report-1', status: 'resolved' }]
      if (text.includes('from public.posts') && text.includes('for update')) return [{ state: 'removed' }]
      if (text.includes('from public.moderation_actions') && text.includes('order by created_at desc')) return []
      return []
    }
    const repository = createAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.moderateContent(adminId, {
      targetType: 'post',
      targetId,
      action: 'restore',
      note: 'Restore requested.',
    })).rejects.toThrow('moderation_restore_forbidden')
  })

  it('restores a job to published status and records the action', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.content_reports') && text.includes('for update')) return [{ id: 'report-1', status: 'resolved' }]
      if (text.includes('from public.jobs') && text.includes('for update')) return [{ state: 'closed' }]
      if (text.includes('from public.moderation_actions') && text.includes('order by created_at desc')) return [{ action: 'remove' }]
      return []
    }
    const repository = createAdminRepository({ query, transaction: async (work) => work(query) })

    await repository.moderateContent(adminId, {
      targetType: 'job',
      targetId,
      action: 'restore',
      note: 'Employer verification completed.',
    })

    expect(seen.some((entry) => entry.text.includes('update public.jobs') && entry.text.includes("status = 'published'"))).toBe(true)
    expect(seen.find((entry) => entry.text.includes('insert into public.moderation_actions'))?.values).toContain('restore')
  })
})
