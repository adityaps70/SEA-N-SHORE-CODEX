import { describe, expect, it, vi } from 'vitest'
import { createDeletedPostRetention } from './deleted-post-retention'

describe('deleted post retention', () => {
  it('audits and permanently purges only expired soft-deleted posts in bounded batches', async () => {
    const query = vi.fn<(text: string, values?: readonly unknown[]) => Promise<Array<{ id: string }>>>()
    query.mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111' },
      { id: '22222222-2222-4222-8222-222222222222' },
    ])
    const retention = createDeletedPostRetention({ query })

    await expect(retention.purgeExpiredDeletedPosts(200)).resolves.toEqual({
      purged: 2,
      postIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
    })

    const [sql, values] = vi.mocked(query).mock.calls[0] ?? []
    expect(sql).toMatch(/from public\.posts/i)
    expect(sql).toMatch(/deleted_at is not null/i)
    expect(sql).toMatch(/purge_after <= now\(\)/i)
    expect(sql).toMatch(/for update skip locked/i)
    expect(sql).toMatch(/insert into public\.audit_events/i)
    expect(sql).toMatch(/content\.post_purged/i)
    expect(sql).toMatch(/delete from public\.posts/i)
    expect(sql).not.toMatch(/p\.body/i)
    expect(values).toEqual([200])
  })

  it('clamps the batch size to a safe range', async () => {
    const query = vi.fn<(text: string, values?: readonly unknown[]) => Promise<Array<{ id: string }>>>()
    query.mockResolvedValue([])
    const retention = createDeletedPostRetention({ query })

    await retention.purgeExpiredDeletedPosts(5000)

    expect(vi.mocked(query).mock.calls[0]?.[1]).toEqual([500])
  })
})
