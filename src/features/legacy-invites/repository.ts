import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'

export type LegacyInviteStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'

export type LegacyInviteDelivery = {
  id: string
  profileId: string
  email: string
  fullName: string
  claimToken: string
  attempts: number
  stillEligible: boolean
}

export type LegacyInviteMetrics = {
  eligible: number
  queued: number
  sending: number
  sent: number
  failed: number
  skipped: number
}

export type LegacyInviteRecent = {
  id: string
  email: string
  fullName: string
  status: LegacyInviteStatus
  attempts: number
  sentAt: string | null
  lastError: string | null
}

type Query = <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<T[]>

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function status(value: unknown): LegacyInviteStatus {
  return value === 'queued' || value === 'sending' || value === 'sent' || value === 'failed' || value === 'skipped'
    ? value
    : 'failed'
}

function eligibleSql() {
  return `
    with candidate_emails as (
      select
        lower(claim.email) as email,
        min(claim.profile_id::text)::uuid as profile_id,
        count(distinct claim.profile_id) as profile_count
      from public.legacy_profile_claims claim
      join public.profiles profile on profile.id = claim.profile_id
      where claim.claimed_at is null
        and claim.email is not null
        and profile.account_status in ('active', 'restricted')
      group by lower(claim.email)
      having count(distinct claim.profile_id) = 1
    )
    select candidate.email, candidate.profile_id
    from candidate_emails candidate
    where not exists (
      select 1
      from public.identity_accounts identity
      where identity.email_verified = true
        and lower(identity.email) = candidate.email
    )
      and not exists (
        select 1
        from public.legacy_profile_invites invite
        where lower(invite.email) = candidate.email
      )
  `
}

export function createLegacyInviteRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  return {
    async metrics(): Promise<LegacyInviteMetrics> {
      const rows = await queryRows<{
        eligible: number | string
        queued: number | string
        sending: number | string
        sent: number | string
        failed: number | string
        skipped: number | string
      }>(`
        select
          (select count(*) from (${eligibleSql()}) eligible_rows) as eligible,
          count(*) filter (where status = 'queued') as queued,
          count(*) filter (where status = 'sending') as sending,
          count(*) filter (where status = 'sent') as sent,
          count(*) filter (where status = 'failed') as failed,
          count(*) filter (where status = 'skipped') as skipped
        from public.legacy_profile_invites
      `)
      const row = rows[0]
      return {
        eligible: num(row?.eligible),
        queued: num(row?.queued),
        sending: num(row?.sending),
        sent: num(row?.sent),
        failed: num(row?.failed),
        skipped: num(row?.skipped),
      }
    },

    async queueEligible(limit: number, adminId: string) {
      const bounded = Math.max(1, Math.min(100, Math.floor(limit)))
      const rows = await queryRows<{ id: string }>(`
        with eligible as (
          ${eligibleSql()}
          order by email
          limit $2
        )
        insert into public.legacy_profile_invites (profile_id, email, queued_by)
        select eligible.profile_id, eligible.email, $1
        from eligible
        on conflict do nothing
        returning id
      `, [adminId, bounded])
      return rows.length
    },

    async claimBatch(limit = 25): Promise<LegacyInviteDelivery[]> {
      const bounded = Math.max(1, Math.min(50, Math.floor(limit)))
      return withTransaction(async (client: DatabaseQueryClient) => {
        const result = await client.query<{
          id: string
          profile_id: string
          email: string
          claim_token: string
          attempts: number
          full_name: string
          still_eligible: boolean
        }>(`
          with picked as (
            select invite.id
            from public.legacy_profile_invites invite
            where invite.status in ('queued', 'failed')
              and invite.attempts < 3
              and invite.next_attempt_at <= now()
            order by invite.queued_at, invite.id
            for update skip locked
            limit $1
          ),
          claimed as (
            update public.legacy_profile_invites invite
            set status = 'sending',
                attempts = invite.attempts + 1,
                last_attempt_at = now(),
                updated_at = now()
            from picked
            where invite.id = picked.id
            returning invite.*
          )
          select
            claimed.id,
            claimed.profile_id,
            claimed.email,
            claimed.claim_token::text,
            claimed.attempts,
            profile.full_name,
            (
              exists (
                select 1
                from public.legacy_profile_claims legacy
                where legacy.profile_id = claimed.profile_id
                  and legacy.claimed_at is null
                  and lower(legacy.email) = lower(claimed.email)
              )
              and not exists (
                select 1
                from public.identity_accounts identity
                where identity.email_verified = true
                  and lower(identity.email) = lower(claimed.email)
              )
            ) as still_eligible
          from claimed
          join public.profiles profile on profile.id = claimed.profile_id
        `, [bounded])

        return result.rows.map((row) => ({
          id: row.id,
          profileId: row.profile_id,
          email: row.email,
          fullName: row.full_name,
          claimToken: row.claim_token,
          attempts: row.attempts,
          stillEligible: Boolean(row.still_eligible),
        }))
      })
    },

    async markSent(id: string, messageId: string) {
      await queryRows(`
        update public.legacy_profile_invites
        set status = 'sent',
            resend_message_id = $2,
            last_error = null,
            sent_at = now(),
            updated_at = now()
        where id = $1
      `, [id, messageId])
    },

    async markSkipped(id: string, reason: string) {
      await queryRows(`
        update public.legacy_profile_invites
        set status = 'skipped',
            last_error = left($2, 500),
            skipped_at = now(),
            updated_at = now()
        where id = $1
      `, [id, reason])
    },

    async markFailed(id: string, error: string, retryable: boolean) {
      await queryRows(`
        update public.legacy_profile_invites
        set status = case when $3 and attempts < 3 then 'queued' else 'failed' end,
            last_error = left($2, 500),
            next_attempt_at = case
              when $3 and attempts < 3 then now() + make_interval(mins => greatest(2, attempts * 5))
              else next_attempt_at
            end,
            updated_at = now()
        where id = $1
      `, [id, error, retryable])
    },

    async emailForClaimToken(token: string) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) return null
      const rows = await queryRows<{ email: string }>(`
        select email
        from public.legacy_profile_invites
        where claim_token = $1::uuid
          and status <> 'skipped'
        limit 1
      `, [token])
      return rows[0]?.email ?? null
    },

    async recent(limit = 50): Promise<LegacyInviteRecent[]> {
      const rows = await queryRows<{
        id: string
        email: string
        full_name: string
        status: string
        attempts: number
        sent_at: string | Date | null
        last_error: string | null
      }>(`
        select invite.id, invite.email, profile.full_name, invite.status, invite.attempts,
               invite.sent_at, invite.last_error
        from public.legacy_profile_invites invite
        join public.profiles profile on profile.id = invite.profile_id
        order by invite.queued_at desc
        limit $1
      `, [Math.max(1, Math.min(100, Math.floor(limit)))])
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        status: status(row.status),
        attempts: row.attempts,
        sentAt: row.sent_at instanceof Date ? row.sent_at.toISOString() : row.sent_at,
        lastError: row.last_error ?? null,
      }))
    },
  }
}

export const legacyInviteRepository = createLegacyInviteRepository()
