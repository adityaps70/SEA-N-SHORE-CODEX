import { describe, expect, it, vi } from 'vitest'
import { createAccountDeletionRepository } from './repository'

const profileId = '11111111-1111-4111-8111-111111111111'

describe('account deletion repository', () => {
  it('purges user-owned data, anonymizes retained references, and tombstones the profile transactionally', async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = []
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      calls.push({ sql, values })
      if (/select id, account_status/i.test(sql)) {
        return [{ id: profileId, account_status: 'active' }]
      }
      if (/as storage_path/i.test(sql) && /union all/i.test(sql)) {
        return [
          { storage_path: `profiles/${profileId}/avatar.webp` },
          { storage_path: `messages/${profileId}/conversation/file.pdf` },
        ]
      }
      return []
    })
    const transaction = vi.fn(async (work: (query: typeof query) => Promise<unknown>) => work(query))
    const deleteIdentity = vi.fn(async () => undefined)

    const repository = createAccountDeletionRepository({ transaction })
    const result = await repository.deleteAccountWithIdentity(profileId, deleteIdentity)

    expect(result.mediaPaths).toEqual([
      `profiles/${profileId}/avatar.webp`,
      `messages/${profileId}/conversation/file.pdf`,
    ])
    expect(deleteIdentity).toHaveBeenCalledTimes(1)

    const sql = calls.map((call) => call.sql).join('\n')
    expect(sql).toMatch(/update public\.messages[\s\S]*deleted_at/i)
    expect(sql).toMatch(/delete from public\.job_applications/i)
    expect(sql).toMatch(/delete from public\.connections/i)
    expect(sql).toMatch(/delete from public\.learning_certificates/i)
    expect(sql).toMatch(/delete from public\.learning_enrollments/i)
    expect(sql).toMatch(/update public\.learning_mentor_applications[\s\S]*Deleted member/i)
    expect(sql).toMatch(/update public\.audit_events[\s\S]*actor_id = null/i)
    expect(sql).toMatch(/delete from public\.identity_accounts/i)
    expect(sql).toMatch(/update public\.profiles[\s\S]*account_status = 'deletion_requested'/i)
    expect(sql).toMatch(/full_name = 'Deleted member'/i)
  })

  it('never calls Cognito deletion when database cleanup preparation fails', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/select id, account_status/i.test(sql)) throw new Error('database_unavailable')
      return []
    })
    const transaction = vi.fn(async (work: (query: typeof query) => Promise<unknown>) => work(query))
    const deleteIdentity = vi.fn(async () => undefined)
    const repository = createAccountDeletionRepository({ transaction })

    await expect(repository.deleteAccountWithIdentity(profileId, deleteIdentity)).rejects.toThrow('database_unavailable')
    expect(deleteIdentity).not.toHaveBeenCalled()
  })

  it('can retry finalization after Cognito deletion if the first database commit fails', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/select id, account_status/i.test(sql)) return [{ id: profileId, account_status: 'deletion_requested' }]
      if (/as storage_path/i.test(sql) && /union all/i.test(sql)) return []
      return []
    })
    const transaction = vi.fn(async (work: (query: typeof query) => Promise<unknown>) => work(query))
    const repository = createAccountDeletionRepository({ transaction })

    await expect(repository.finalizeAccountDeletion(profileId)).resolves.toEqual({ mediaPaths: [] })
  })
})
