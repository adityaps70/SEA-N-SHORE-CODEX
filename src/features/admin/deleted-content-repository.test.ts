import { describe, expect, it } from 'vitest'
import { createAdminRepository } from './repository'

const adminId = '11111111-1111-4111-8111-111111111111'
const postId = '22222222-2222-4222-8222-222222222222'
const authorId = '33333333-3333-4333-8333-333333333333'

describe('deleted post recovery repository', () => {
  it('lists soft-deleted posts with deletion actor, reason and purge deadline for administrators', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('public.user_roles')) return [{ allowed: true }]
        return [{
          post_id: postId,
          body: 'Archived safety discussion',
          category: 'safety_lessons',
          author_id: authorId,
          author_name: 'Capt. Example',
          author_slug: 'capt-example',
          deleted_at: '2026-09-20T10:00:00.000Z',
          deleted_by: adminId,
          deleted_by_name: 'Platform Admin',
          deletion_reason: 'Removed after confirmed spam report.',
          purge_after: '2026-10-20T10:00:00.000Z',
          recoverable: true,
        }]
      },
    })

    await expect(repository.listDeletedPosts(adminId, 100)).resolves.toEqual([{
      id: postId,
      body: 'Archived safety discussion',
      category: 'safety_lessons',
      author: { id: authorId, fullName: 'Capt. Example', slug: 'capt-example' },
      deletedAt: '2026-09-20T10:00:00.000Z',
      deletedBy: { id: adminId, fullName: 'Platform Admin' },
      reason: 'Removed after confirmed spam report.',
      purgeAfter: '2026-10-20T10:00:00.000Z',
      recoverable: true,
    }])

    expect(seen[1]?.text).toMatch(/from public\.posts p/i)
    expect(seen[1]?.text).toMatch(/p\.deleted_at is not null/i)
    expect(seen[1]?.text).toMatch(/p\.purge_after/i)
    expect(seen[1]?.text).toMatch(/left join public\.profiles deletion_actor/i)
    expect(seen[1]?.values).toEqual([100])
  })

  it('restores a retained post, clears deletion metadata and writes recovery audit history', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('public.user_roles ur')) return [{ allowed: true }]
      if (text.includes('from public.posts') && text.includes('for update')) {
        return [{
          id: postId,
          deleted_at: '2026-09-20T10:00:00.000Z',
          purge_after: '2026-10-20T10:00:00.000Z',
          recoverable: true,
        }]
      }
      return []
    }
    const repository = createAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.restoreDeletedPost(adminId, postId, 'Author confirmed the post was deleted accidentally.')).resolves.toBe(true)

    const restore = seen.find((entry) => entry.text.includes('update public.posts') && entry.text.includes('deleted_at = null'))
    expect(restore?.text).toMatch(/deleted_by = null/i)
    expect(restore?.text).toMatch(/deletion_reason = null/i)
    expect(restore?.text).toMatch(/purge_after = null/i)
    expect(restore?.values).toEqual([postId])

    const moderation = seen.find((entry) => entry.text.includes('insert into public.moderation_actions'))
    expect(moderation?.values).toContain('restore')
    expect(String(moderation?.values?.at(-2))).toContain('Author confirmed the post was deleted accidentally.')

    const audit = seen.find((entry) => entry.text.includes('insert into public.audit_events'))
    expect(audit?.values).toContain('content.post_restored_from_recovery')
  })

  it('refuses recovery after the retention deadline', async () => {
    const query = async (text: string) => {
      if (text.includes('public.user_roles ur')) return [{ allowed: true }]
      if (text.includes('from public.posts') && text.includes('for update')) {
        return [{
          id: postId,
          deleted_at: '2026-08-01T10:00:00.000Z',
          purge_after: '2026-08-31T10:00:00.000Z',
          recoverable: false,
        }]
      }
      return []
    }
    const repository = createAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.restoreDeletedPost(adminId, postId, 'Recovery requested too late.')).rejects.toThrow('deleted_post_retention_expired')
  })
})
