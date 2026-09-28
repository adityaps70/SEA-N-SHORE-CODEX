import { describe, expect, it, vi } from 'vitest'
import { createAccountDeletionRepository } from './repository'

const profileId = '11111111-1111-4111-8111-111111111111'

type TestQuery = (sql: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

function transactionFor(query: TestQuery) {
  return async function transaction<T>(work: (query: TestQuery) => Promise<T>): Promise<T> {
    return work(query)
  }
}

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
    const transaction = transactionFor(query as TestQuery)
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
    expect(sql).toMatch(/delete from public\.post_hides/i)
    expect(sql).toMatch(/update public\.newsletter_subscribers[\s\S]*status = 'unsubscribed'/i)
    expect(sql).toMatch(/'unsubscribed', topics, 'account_deletion'/i)
    expect(sql).toMatch(/update public\.profiles[\s\S]*account_status = 'deletion_requested'/i)
    expect(sql).toMatch(/full_name = 'Deleted member'/i)
  })

  it('never calls Cognito deletion when database cleanup preparation fails', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/select id, account_status/i.test(sql)) throw new Error('database_unavailable')
      return []
    })
    const transaction = transactionFor(query as TestQuery)
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
    const transaction = transactionFor(query as TestQuery)
    const repository = createAccountDeletionRepository({ transaction })

    await expect(repository.finalizeAccountDeletion(profileId)).resolves.toMatchObject({ mediaPaths: [], refundOrderIds: [] })
  })

  describe('owned content and organizations', () => {
    const soleCompany = '66666666-6666-4666-8666-666666666666'
    const sharedCompany = '77777777-7777-4777-8777-777777777777'

    function scenario(options: { claimStatusTable?: string | null } = {}) {
      const calls: Array<{ sql: string; values?: readonly unknown[] }> = []
      const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
        calls.push({ sql, values })
        const text = sql.replace(/\s+/g, ' ')
        if (/select id, account_status/i.test(text)) return [{ id: profileId, account_status: 'active' }]
        if (text.includes('from public.company_members cm join public.companies c on c.id = cm.company_id where cm.user_id = $1')) {
          return [
            { company_id: sharedCompany, name: 'Blue Fleet', slug: 'blue-fleet', role: 'owner' },
            { company_id: soleCompany, name: 'Harbour Academy', slug: 'harbour-academy', role: 'administrator' },
          ]
        }
        if (text.includes('as other_active_managers')) {
          return [
            { company_id: sharedCompany, other_active_managers: '2', jobs: '4', events: '1', courses: '0' },
            { company_id: soleCompany, other_active_managers: '0', jobs: '3', events: '1', courses: '2' },
          ]
        }
        if (text.includes('as posts,')) return [{ posts: '5', comments: '2', reactions: '9' }]
        if (text.includes('as courses_with_learners')) return [{ jobs: '1', events: '2', courses: '1', courses_with_learners: '1' }]
        if (text.includes('from public.seller_earnings')) return [{ currency: 'INR', amount_minor: '125000' }]
        if (text.includes('from public.subscription_checkouts')) return []
        if (text.includes('as upcoming_with_registrations')) return [{ upcoming_with_registrations: '1', paid_tickets: '2' }]
        if (text.startsWith('select o.id from public.event_payment_orders')) return [{ id: 'order-1' }, { id: 'order-2' }]
        if (text.startsWith('select distinct ea.user_id')) return [{ user_id: 'attendee-1', event_id: 'event-1', title: 'Tanker safety' }]
        if (text.includes('delete from public.events e')) return [{ storage_path: 'events/banner.webp' }]
        if (text.includes('from public.identity_accounts where profile_id = $1 and provider')) {
          return [
            { provider_subject: 'email-sub', provider_username: 'email-user' },
            { provider_subject: 'phone-sub', provider_username: 'phone-user' },
          ]
        }
        if (text.includes('from information_schema.columns')) return options.claimStatusTable ? [{ table_name: options.claimStatusTable }] : []
        return []
      })
      return { calls, query }
    }

    it('removes only personal items and those of organizations the member alone manages, never an organization', async () => {
      const { calls, query } = scenario({ claimStatusTable: 'companies' })
      const repository = createAccountDeletionRepository({ transaction: transactionFor(query as TestQuery) })
      const result = await repository.deleteAccountWithIdentity(profileId, vi.fn(async () => undefined), { currentSub: 'email-sub' })

      const find = (pattern: RegExp) => calls.filter((call) => pattern.test(call.sql.replace(/\s+/g, ' ')))
      const cancel = find(/update public\.events e set status = 'cancelled'/i)
      expect(cancel).toHaveLength(1)
      expect(cancel[0]!.values).toEqual([profileId, [soleCompany]])
      expect(find(/update public\.jobs set status = 'closed'/i)[0]!.values).toEqual([profileId, [soleCompany]])
      expect(find(/update public\.learning_courses set status = 'archived'/i)[0]!.values).toEqual([profileId, [soleCompany]])
      expect(find(/removed_at = coalesce\(removed_at, now\(\)\)/i)).toHaveLength(1)
      expect(find(/delete from public\.companies/i)).toHaveLength(0)
      expect(find(/delete from public\.events where host_user_id = \$1/i)).toHaveLength(0)
      expect(find(/delete from public\.posts where author_id = \$1 and company_id is null/i)).toHaveLength(1)
      // The only-managed organization becomes claimable, guarded by a savepoint.
      expect(find(/savepoint account_deletion_claim_status/i).length).toBeGreaterThan(0)
      const unclaim = find(/update public\.companies c set claim_status = 'unclaimed', is_verified = false/i)
      expect(unclaim).toHaveLength(1)
      expect(unclaim[0]!.values).toEqual([soleCompany])
      // 0050 allows one unclaimed page per name: a clash is skipped, never an error.
      expect(unclaim[0]!.sql.replace(/\s+/g, ' ')).toContain("other.claim_status = 'unclaimed' and lower(btrim(other.name)) = lower(btrim(c.name))")

      expect(result.refundOrderIds).toEqual(['order-1', 'order-2'])
      expect(result.cancelledEventAttendees).toEqual([{ profileId: 'attendee-1', eventId: 'event-1', eventTitle: 'Tanker safety' }])
      expect(result.otherSignInUsernames).toEqual(['phone-user'])
      expect(result.mediaPaths).toContain('events/banner.webp')
      expect(result.plan?.strippedCompanyIds).toEqual([soleCompany])
      // Memberships of every managed organization are locked before deciding.
      expect(find(/for update$/i).some((call) => JSON.stringify(call.values) === JSON.stringify([[sharedCompany, soleCompany]]))).toBe(true)
    })

    it('never fails the deletion when marking a page unclaimed clashes with another unclaimed page', async () => {
      const { calls, query } = scenario({ claimStatusTable: 'companies' })
      const base = query.getMockImplementation()!
      query.mockImplementation(async (sql: string, values?: readonly unknown[]) => {
        if (/update public\.companies c/.test(sql)) {
          calls.push({ sql, values })
          throw Object.assign(new Error('duplicate key value violates unique constraint "companies_unclaimed_name_key"'), { code: '23505' })
        }
        return base(sql, values)
      })
      const repository = createAccountDeletionRepository({ transaction: transactionFor(query as TestQuery) })
      await expect(repository.deleteAccountWithIdentity(profileId, vi.fn(async () => undefined))).resolves.toMatchObject({ refundOrderIds: ['order-1', 'order-2'] })
      expect(calls.some((call) => /rollback to savepoint account_deletion_claim_status/.test(call.sql))).toBe(true)
      expect(calls.some((call) => /update public\.profiles[\s\S]*deletion_requested/.test(call.sql))).toBe(true)
    })

    it('skips the unclaimed marker when the claim workflow does not exist yet', async () => {
      const { calls, query } = scenario({ claimStatusTable: null })
      const repository = createAccountDeletionRepository({ transaction: transactionFor(query as TestQuery) })
      await repository.deleteAccountWithIdentity(profileId, vi.fn(async () => undefined))
      expect(calls.some((call) => /claim_status = 'unclaimed'/.test(call.sql))).toBe(false)
      expect(calls.some((call) => /savepoint/.test(call.sql))).toBe(false)
    })

    it('builds the delete-account screen plan from the same data without changing anything', async () => {
      const { calls, query } = scenario()
      const repository = createAccountDeletionRepository({ query: query as TestQuery })
      const plan = await repository.getDeletionPlan(profileId)
      expect(plan.organizations.map((organization) => organization.summary)).toEqual([
        'Stays — managed by 2 others',
        'Page stays; its 3 jobs, 1 event and 2 courses will be removed',
      ])
      expect(plan.warnings[0]).toContain('₹1,250')
      expect(calls.some((call) => /^\s*(update|delete|insert)/i.test(call.sql))).toBe(false)
      expect(calls.some((call) => /for update/i.test(call.sql))).toBe(false)
    })
  })
})
