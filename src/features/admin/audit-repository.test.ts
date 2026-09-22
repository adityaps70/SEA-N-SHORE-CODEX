import { describe, expect, it } from 'vitest'
import { createAdminRepository } from './repository'

const adminId = '11111111-1111-4111-8111-111111111111'

describe('platform admin audit repository', () => {
  it('authorizes admins before loading a bounded audit log with actor context', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('public.user_roles')) return [{ allowed: true }]
        return [{
          id: 'audit-1',
          actor_id: adminId,
          actor_name: 'Admin User',
          actor_slug: 'admin-user',
          action: 'moderation.content_removed',
          target_type: 'post',
          target_id: '22222222-2222-4222-8222-222222222222',
          metadata: { note: 'Scam report confirmed.', reportCount: 3 },
          created_at: '2026-09-22T05:00:00.000Z',
        }]
      },
    })

    await expect(repository.listAuditEvents(adminId, {
      targetType: 'all',
      limit: 50,
    })).resolves.toEqual([{
      id: 'audit-1',
      actor: { id: adminId, fullName: 'Admin User', slug: 'admin-user' },
      action: 'moderation.content_removed',
      targetType: 'post',
      targetId: '22222222-2222-4222-8222-222222222222',
      metadata: { note: 'Scam report confirmed.', reportCount: 3 },
      createdAt: '2026-09-22T05:00:00.000Z',
    }])

    expect(seen[1]?.text).toContain('public.audit_events')
    expect(seen[1]?.text).toContain('left join public.profiles')
    expect(seen[1]?.text).toContain('order by ae.created_at desc')
    expect(seen[1]?.values).toEqual([50])
  })

  it('filters audit events by target type', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('public.user_roles')) return [{ allowed: true }]
        return []
      },
    })

    await repository.listAuditEvents(adminId, { targetType: 'job', limit: 25 })

    expect(seen[1]?.text).toContain('ae.target_type = $1')
    expect(seen[1]?.values).toEqual(['job', 25])
  })
})
