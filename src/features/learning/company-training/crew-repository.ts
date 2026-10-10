import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { loadTrainingCompany, type Query, type TrainingActor } from './company-access'
import { CONSENT_VERSION, CrewError, INVITATION_DAYS, INVITE_BATCH_MAX, INVITES_PER_DAY } from './crew-rules'

/**
 * Company training crew (round D, part 3). A company invites people by email; a Sea N Shore member whose verified email
 * matches accepts (consent to share assigned-course progress and certificates, recorded in an append-only ledger) or
 * declines. A member can stop sharing at any time; the company can remove someone from its crew. Seats can only be
 * given to active crew members (seat-repository.ts).
 */

type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

function clientQuery(client: DatabaseQueryClient): Query {
  return async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null
  return new Date(value instanceof Date ? value.getTime() : String(value)).toISOString()
}

export type CrewStatus = 'active' | 'withdrawn' | 'removed'

export type CrewMember = {
  profileId: string
  name: string
  slug: string | null
  avatarPath: string | null
  status: CrewStatus
  vessel: string | null
  rank: string | null
  joinedAt: string
  withdrawnAt: string | null
  /** Seats of this company the member holds now. */
  seats: number
}

export type CrewInvitation = {
  id: string
  email: string
  vessel: string | null
  rank: string | null
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  emailStatus: 'pending' | 'sent' | 'failed'
  createdAt: string
  expiresAt: string
}

export type MemberInvitation = {
  id: string
  companyId: string
  companyName: string
  companySlug: string
  companyLogoPath: string | null
  inviterName: string | null
  expiresAt: string
}

export type MemberSharing = {
  companyId: string
  companyName: string
  companySlug: string
  status: CrewStatus
  consentedAt: string
  withdrawnAt: string | null
  courses: number
}

export type InviteOutcome = { invited: number; alreadyInCrew: number; alreadyInvited: number }

/** A member's verified sign-in email addresses. */
const MEMBER_EMAILS_SQL = `select lower(account.email) from public.identity_accounts account
  where account.profile_id = $1::uuid and account.email_verified = true and account.email is not null`

async function audit(query: Query, actorId: string, action: string, companyId: string, metadata: Record<string, unknown>) {
  await query(
    `insert into public.audit_events (actor_id, action, target_type, target_id, metadata) values ($1::uuid, $2, 'company', $3, $4::jsonb)`,
    [actorId, action, companyId, JSON.stringify(metadata)],
  )
}

async function consentEvent(query: Query, input: { companyId: string; profileId: string; event: 'granted' | 'withdrawn'; source: 'invitation' | 'my_learning' | 'company_removed' }) {
  await query(
    `insert into public.company_training_consent_events (company_id, profile_id, event, consent_version, source) values ($1::uuid, $2::uuid, $3, $4, $5)`,
    [input.companyId, input.profileId, input.event, CONSENT_VERSION, input.source],
  )
}

export function createCrewRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction: Transaction = input.transaction ?? (<T>(work: (query: Query) => Promise<T>) => withTransaction((client) => work(clientQuery(client))))

  /** Invites up to 50 addresses. Members already in the crew and addresses already invited are skipped. */
  async function invite(actor: TrainingActor, companyId: string, request: { emails: string[]; vessel?: string | null; rank?: string | null }): Promise<InviteOutcome> {
    if (!request.emails.length) throw new CrewError('invite_none')
    if (request.emails.length > INVITE_BATCH_MAX) throw new CrewError('invite_too_many')
    return transaction(async (tx) => {
      await loadTrainingCompany(tx, actor, companyId, { manage: true, lock: true })
      const recent = await tx(
        `select count(*)::int as count from public.company_training_invitations where company_id = $1::uuid and created_at > now() - interval '24 hours'`,
        [companyId],
      )
      if (Number(recent[0]?.count ?? 0) + request.emails.length > INVITES_PER_DAY) throw new CrewError('invite_daily_limit')
      const inCrew = await tx(
        `select lower(account.email) as email
         from public.company_training_learners learner
         inner join public.identity_accounts account on account.profile_id = learner.profile_id and account.email_verified = true
         where learner.company_id = $1::uuid and learner.status = 'active' and lower(account.email) = any($2::text[])`,
        [companyId, request.emails],
      )
      const crewEmails = new Set(inCrew.map((row) => String(row.email)))
      const outcome: InviteOutcome = { invited: 0, alreadyInCrew: 0, alreadyInvited: 0 }
      for (const email of request.emails) {
        if (crewEmails.has(email)) {
          outcome.alreadyInCrew += 1
          continue
        }
        const rows = await tx(
          `insert into public.company_training_invitations (company_id, email, vessel, rank, invited_by, expires_at)
           values ($1::uuid, $2, $3, $4, $5::uuid, now() + make_interval(days => $6::integer))
           on conflict (company_id, email) where status = 'pending' do nothing
           returning id`,
          [companyId, email, request.vessel ?? null, request.rank ?? null, actor.actorId, INVITATION_DAYS],
        )
        if (rows[0]) outcome.invited += 1
        else outcome.alreadyInvited += 1
      }
      await audit(tx, actor.actorId, 'company_training.invited', companyId, { ...outcome })
      return outcome
    })
  }

  async function cancelInvitation(actor: TrainingActor, companyId: string, invitationId: string) {
    return transaction(async (tx) => {
      await loadTrainingCompany(tx, actor, companyId, { manage: true })
      const rows = await tx(
        `update public.company_training_invitations set status = 'cancelled', updated_at = now()
         where id = $1::uuid and company_id = $2::uuid and status = 'pending' returning id`,
        [invitationId, companyId],
      )
      if (!rows[0]) throw new CrewError('invitation_not_found')
      await audit(tx, actor.actorId, 'company_training.invitation_cancelled', companyId, {})
    })
  }

  /** The crew and the open invitations, for the company's training page. */
  async function list(actor: TrainingActor, companyId: string): Promise<{ members: CrewMember[]; invitations: CrewInvitation[] }> {
    await loadTrainingCompany(query, actor, companyId)
    const [members, invitations] = await Promise.all([
      query(
        `select learner.profile_id, profile.full_name, profile.slug, profile.avatar_path, learner.status, learner.vessel, learner.rank,
                learner.consented_at, learner.withdrawn_at,
                (select count(*)::int from public.company_training_seats seat
                  where seat.company_id = learner.company_id and seat.learner_id = learner.profile_id and seat.status = 'assigned') as seats
         from public.company_training_learners learner
         inner join public.profiles profile on profile.id = learner.profile_id
         where learner.company_id = $1::uuid and learner.status <> 'removed'
         order by learner.status, lower(profile.full_name), learner.profile_id
         limit 2000`,
        [companyId],
      ),
      query(
        `select id, email, vessel, rank, status, email_status, created_at, expires_at
         from public.company_training_invitations
         where company_id = $1::uuid and status = 'pending' and expires_at > now()
         order by created_at desc
         limit 500`,
        [companyId],
      ),
    ])
    return {
      members: members.map((row) => ({
        profileId: String(row.profile_id),
        name: String(row.full_name ?? '').trim() || 'Sea N Shore member',
        slug: row.slug ? String(row.slug) : null,
        avatarPath: row.avatar_path ? String(row.avatar_path) : null,
        status: row.status as CrewStatus,
        vessel: row.vessel ? String(row.vessel) : null,
        rank: row.rank ? String(row.rank) : null,
        joinedAt: iso(row.consented_at) ?? new Date(0).toISOString(),
        withdrawnAt: iso(row.withdrawn_at),
        seats: Number(row.seats ?? 0),
      })),
      invitations: invitations.map((row) => ({
        id: String(row.id),
        email: String(row.email),
        vessel: row.vessel ? String(row.vessel) : null,
        rank: row.rank ? String(row.rank) : null,
        status: row.status as CrewInvitation['status'],
        emailStatus: row.email_status as CrewInvitation['emailStatus'],
        createdAt: iso(row.created_at)!,
        expiresAt: iso(row.expires_at)!,
      })),
    }
  }

  /** The company's own vessel and rank tags for a crew member (its records, shown to the member too). */
  async function updateTags(actor: TrainingActor, companyId: string, profileId: string, tags: { vessel: string | null; rank: string | null }) {
    return transaction(async (tx) => {
      await loadTrainingCompany(tx, actor, companyId, { manage: true })
      const rows = await tx(
        `update public.company_training_learners set vessel = $3, rank = $4, updated_at = now()
         where company_id = $1::uuid and profile_id = $2::uuid and status <> 'removed' returning profile_id`,
        [companyId, profileId, tags.vessel, tags.rank],
      )
      if (!rows[0]) throw new CrewError('crew_member_not_found')
      await audit(tx, actor.actorId, 'company_training.crew_tags_updated', companyId, {})
    })
  }

  /** Takes someone off the crew (e.g. they left the company). Seats they hold stay used; the company stops seeing their data. */
  async function remove(actor: TrainingActor, companyId: string, profileId: string) {
    return transaction(async (tx) => {
      await loadTrainingCompany(tx, actor, companyId, { manage: true })
      const rows = await tx(
        `update public.company_training_learners set status = 'removed', removed_at = now(), updated_at = now()
         where company_id = $1::uuid and profile_id = $2::uuid and status <> 'removed' returning status`,
        [companyId, profileId],
      )
      if (!rows[0]) throw new CrewError('crew_member_not_found')
      await consentEvent(tx, { companyId, profileId, event: 'withdrawn', source: 'company_removed' })
      await audit(tx, actor.actorId, 'company_training.crew_removed', companyId, {})
    })
  }

  /** Open invitations sent to one of the member's verified email addresses. */
  async function invitationsForMember(profileId: string): Promise<MemberInvitation[]> {
    const rows = await query(
      `select invitation.id, invitation.company_id, invitation.expires_at, company.name as company_name, company.slug as company_slug,
              company.logo_path, inviter.full_name as inviter_name
       from public.company_training_invitations invitation
       inner join public.companies company on company.id = invitation.company_id
       left join public.profiles inviter on inviter.id = invitation.invited_by
       where invitation.status = 'pending' and invitation.expires_at > now() and invitation.email in (${MEMBER_EMAILS_SQL})
         and not exists (
           select 1 from public.company_training_learners learner
           where learner.company_id = invitation.company_id and learner.profile_id = $1::uuid and learner.status = 'active'
         )
       order by invitation.created_at desc
       limit 20`,
      [profileId],
    )
    return rows.map((row) => ({
      id: String(row.id),
      companyId: String(row.company_id),
      companyName: String(row.company_name),
      companySlug: String(row.company_slug),
      companyLogoPath: row.logo_path ? String(row.logo_path) : null,
      inviterName: row.inviter_name ? String(row.inviter_name).trim() || null : null,
      expiresAt: iso(row.expires_at)!,
    }))
  }

  /** One invitation for the member it was sent to. Throws CrewError with the reason when they cannot answer it. */
  async function invitationForMember(profileId: string, invitationId: string, run: Query = query, lock = false) {
    const rows = await run(
      `select invitation.id, invitation.company_id, invitation.status, invitation.expires_at, invitation.vessel, invitation.rank,
              invitation.email in (${MEMBER_EMAILS_SQL}) as mine,
              company.name as company_name, company.slug as company_slug, company.logo_path, inviter.full_name as inviter_name
       from public.company_training_invitations invitation
       inner join public.companies company on company.id = invitation.company_id
       left join public.profiles inviter on inviter.id = invitation.invited_by
       where invitation.id = $2::uuid
       ${lock ? 'for update of invitation' : ''}`,
      [profileId, invitationId],
    )
    const row = rows[0]
    if (!row) throw new CrewError('invitation_not_found')
    if (!row.mine) throw new CrewError('invitation_other_email')
    const open = row.status === 'pending' && new Date(String(iso(row.expires_at))).getTime() > Date.now()
    return {
      invitation: {
        id: String(row.id),
        companyId: String(row.company_id),
        companyName: String(row.company_name),
        companySlug: String(row.company_slug),
        companyLogoPath: row.logo_path ? String(row.logo_path) : null,
        inviterName: row.inviter_name ? String(row.inviter_name).trim() || null : null,
        expiresAt: iso(row.expires_at)!,
      } satisfies MemberInvitation,
      status: String(row.status) as CrewInvitation['status'],
      open,
      tags: { vessel: row.vessel ? String(row.vessel) : null, rank: row.rank ? String(row.rank) : null },
    }
  }

  /** The member accepts: they join the crew and their consent is recorded. */
  async function accept(profileId: string, invitationId: string) {
    return transaction(async (tx) => {
      const found = await invitationForMember(profileId, invitationId, tx, true)
      if (!found.open) throw new CrewError('invitation_closed')
      const companyId = found.invitation.companyId
      await tx(
        `insert into public.company_training_learners (company_id, profile_id, status, vessel, rank, invitation_id, consent_version, consented_at)
         values ($1::uuid, $2::uuid, 'active', $3, $4, $5::uuid, $6, now())
         on conflict (company_id, profile_id) do update
           set status = 'active', vessel = coalesce(excluded.vessel, company_training_learners.vessel),
               rank = coalesce(excluded.rank, company_training_learners.rank), invitation_id = excluded.invitation_id,
               consent_version = excluded.consent_version, consented_at = now(), withdrawn_at = null, removed_at = null, updated_at = now()`,
        [companyId, profileId, found.tags.vessel, found.tags.rank, invitationId, CONSENT_VERSION],
      )
      await tx(
        `update public.company_training_invitations set status = 'accepted', accepted_profile_id = $2::uuid, responded_at = now(), updated_at = now()
         where id = $1::uuid`,
        [invitationId, profileId],
      )
      // Other open invitations from the same company to this member are answered by this one.
      await tx(
        `update public.company_training_invitations set status = 'accepted', accepted_profile_id = $2::uuid, responded_at = now(), updated_at = now()
         where company_id = $1::uuid and status = 'pending' and email in (${MEMBER_EMAILS_SQL.replace('$1', '$2')})`,
        [companyId, profileId],
      )
      await consentEvent(tx, { companyId, profileId, event: 'granted', source: 'invitation' })
      await audit(tx, profileId, 'company_training.invitation_accepted', companyId, {})
      return found.invitation
    })
  }

  async function decline(profileId: string, invitationId: string) {
    return transaction(async (tx) => {
      const found = await invitationForMember(profileId, invitationId, tx, true)
      if (!found.open) throw new CrewError('invitation_closed')
      await tx(
        `update public.company_training_invitations set status = 'declined', responded_at = now(), updated_at = now() where id = $1::uuid`,
        [invitationId],
      )
      await audit(tx, profileId, 'company_training.invitation_declined', found.invitation.companyId, {})
      return found.invitation
    })
  }

  /** The companies the member shares training with (My Learning). */
  async function sharingForMember(profileId: string): Promise<MemberSharing[]> {
    const rows = await query(
      `select learner.company_id, company.name, company.slug, learner.status, learner.consented_at, learner.withdrawn_at,
              (select count(*)::int from public.company_training_seats seat
                where seat.company_id = learner.company_id and seat.learner_id = learner.profile_id and seat.status = 'assigned') as courses
       from public.company_training_learners learner
       inner join public.companies company on company.id = learner.company_id
       where learner.profile_id = $1::uuid and learner.status <> 'removed'
       order by lower(company.name)`,
      [profileId],
    )
    return rows.map((row) => ({
      companyId: String(row.company_id),
      companyName: String(row.name),
      companySlug: String(row.slug),
      status: row.status as CrewStatus,
      consentedAt: iso(row.consented_at)!,
      withdrawnAt: iso(row.withdrawn_at),
      courses: Number(row.courses ?? 0),
    }))
  }

  /** The member stops sharing with a company. Their courses stay theirs; the company sees only that they stopped. */
  async function withdraw(profileId: string, companyId: string) {
    return transaction(async (tx) => {
      const rows = await tx(
        `update public.company_training_learners set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
         where company_id = $1::uuid and profile_id = $2::uuid and status = 'active' returning company_id`,
        [companyId, profileId],
      )
      if (!rows[0]) throw new CrewError('crew_member_not_found')
      await consentEvent(tx, { companyId, profileId, event: 'withdrawn', source: 'my_learning' })
      await audit(tx, profileId, 'company_training.sharing_withdrawn', companyId, {})
    })
  }

  return { invite, cancelInvitation, list, updateTags, remove, invitationsForMember, invitationForMember: (profileId: string, invitationId: string) => invitationForMember(profileId, invitationId), accept, decline, sharingForMember, withdraw }
}

export const crewRepository = createCrewRepository()
