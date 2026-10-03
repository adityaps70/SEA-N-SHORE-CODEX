import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import {
  CREATOR_VERIFICATION_SOURCES,
  CREATOR_VERIFICATION_STATUSES,
  CREATOR_VERIFICATION_TYPES,
  creatorVerificationApplicationSchema,
  type AdminCreatorVerificationApplication,
  type CreatorVerificationApplication,
  type CreatorVerificationSource,
  type CreatorVerificationState,
  type CreatorVerificationStatus,
  type CreatorVerificationType,
} from './application'

type VerificationQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type VerificationTransaction = <T>(work: (query: VerificationQuery) => Promise<T>) => Promise<T>

type VerificationRow = QueryResultRow & {
  id: string
  verification_type: string
  status: string
  source: string
  application_payload: unknown
  submitted_at: string
  reviewed_at: string | null
  review_note: string | null
}

type LockedVerificationRow = QueryResultRow & {
  id: string
  profile_id?: string
  verification_type: string
  status: string
  source: string
}

type ReturningIdRow = QueryResultRow & {
  id: string
}

type AdminVerificationRow = VerificationRow & {
  profile_id: string
  full_name: string
  slug: string | null
  headline: string | null
}

function runtimeTransaction<T>(work: (query: VerificationQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function asType(value: string): CreatorVerificationType {
  if (CREATOR_VERIFICATION_TYPES.includes(value as CreatorVerificationType)) {
    return value as CreatorVerificationType
  }
  throw new Error('verification_type_invalid')
}

function asStatus(value: string): CreatorVerificationStatus {
  if (CREATOR_VERIFICATION_STATUSES.includes(value as CreatorVerificationStatus)) {
    return value as CreatorVerificationStatus
  }
  throw new Error('verification_status_invalid')
}

function asSource(value: string): CreatorVerificationSource {
  if (CREATOR_VERIFICATION_SOURCES.includes(value as CreatorVerificationSource)) {
    return value as CreatorVerificationSource
  }
  throw new Error('verification_source_invalid')
}

function mapApplication(value: unknown): CreatorVerificationApplication | null {
  const parsed = creatorVerificationApplicationSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function mapState(row: VerificationRow): CreatorVerificationState {
  return {
    id: row.id,
    type: asType(row.verification_type),
    status: asStatus(row.status),
    source: asSource(row.source),
    application: mapApplication(row.application_payload),
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
  }
}

async function requireAdministrator(query: VerificationQuery, adminId: string, lock = false) {
  const rows = await query(
    `select true as allowed
     from public.user_roles
     where user_id = $1
       and role::text = 'administrator'
     ${lock ? 'for update' : ''}
     limit 1`,
    [adminId],
  )
  if (!rows[0]) throw new Error('admin_forbidden')
}

export function createCreatorVerificationRepository(input: {
  query?: VerificationQuery
  transaction?: VerificationTransaction
} = {}) {
  const queryRows: VerificationQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function getState(
    profileId: string,
    type: CreatorVerificationType,
  ): Promise<CreatorVerificationState | null> {
    const rows = await queryRows(
      `select
         id,
         verification_type,
         status,
         source,
         application_payload,
         coalesce(submitted_at, created_at) as submitted_at,
         reviewed_at,
         review_note
       from public.feature_verifications
       where profile_id = $1
         and verification_type = $2
       limit 1`,
      [profileId, type],
    ) as VerificationRow[]

    return rows[0] ? mapState(rows[0]) : null
  }

  async function submitApplication(
    profileId: string,
    type: CreatorVerificationType,
    application: CreatorVerificationApplication,
  ) {
    return transaction(async (txQuery) => {
      const currentRows = await txQuery(
        `select id, profile_id, verification_type, status, source
         from public.feature_verifications
         where profile_id = $1
           and verification_type = $2
         for update`,
        [profileId, type],
      ) as LockedVerificationRow[]
      const current = currentRows[0]

      if (current?.status === 'pending') throw new Error('verification_application_pending')
      if (current?.status === 'approved') throw new Error('verification_already_approved')
      if (current?.status === 'suspended') throw new Error('verification_suspended')

      let verificationId: string
      if (current) {
        const rows = await txQuery(
          `update public.feature_verifications
           set status = 'pending',
               source = 'application',
               application_payload = $2::jsonb,
               submitted_at = now(),
               reviewed_by = null,
               reviewed_at = null,
               review_note = null,
               updated_at = now()
           where id = $1
           returning id`,
          [current.id, JSON.stringify(application)],
        ) as ReturningIdRow[]
        verificationId = rows[0]?.id ?? current.id
      } else {
        const rows = await txQuery(
          `insert into public.feature_verifications (
             profile_id,
             verification_type,
             status,
             source,
             application_payload,
             submitted_at,
             created_at,
             updated_at
           )
           values ($1, $2, 'pending', 'application', $3::jsonb, now(), now(), now())
           on conflict (profile_id, verification_type) do nothing
           returning id`,
          [profileId, type, JSON.stringify(application)],
        ) as ReturningIdRow[]
        const created = rows[0]
        if (!created) throw new Error('verification_application_pending')
        verificationId = created.id
      }

      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'verification.application_submitted', 'feature_verification', $2, $3::jsonb)`,
        [
          profileId,
          verificationId,
          JSON.stringify({
            verificationType: type,
            resubmission: Boolean(current),
          }),
        ],
      )

      return { verificationId }
    })
  }

  async function listAdminApplications(
    adminId: string,
    status: CreatorVerificationStatus,
    type?: CreatorVerificationType,
  ): Promise<AdminCreatorVerificationApplication[]> {
    await requireAdministrator(queryRows, adminId)
    const values: unknown[] = [status]
    const typeFilter = type
      ? (() => {
          values.push(type)
          return 'and verification.verification_type = $2'
        })()
      : ''

    const rows = await queryRows(
      `select
         verification.id,
         verification.verification_type,
         verification.status,
         verification.source,
         verification.application_payload,
         coalesce(verification.submitted_at, verification.created_at) as submitted_at,
         verification.reviewed_at,
         verification.review_note,
         profile.id as profile_id,
         profile.full_name,
         profile.slug,
         profile.headline
       from public.feature_verifications verification
       join public.profiles profile on profile.id = verification.profile_id
       where verification.status = $1
         and verification.verification_type in ('recruiter', 'event_host')
         ${typeFilter}
       order by coalesce(verification.submitted_at, verification.created_at) asc, verification.id asc
       limit 100`,
      values,
    ) as AdminVerificationRow[]

    return rows.map((row) => ({
      ...mapState(row),
      applicant: {
        id: row.profile_id,
        fullName: row.full_name,
        slug: row.slug ?? null,
        headline: row.headline ?? null,
      },
    }))
  }

  async function reviewApplication(
    adminId: string,
    verificationId: string,
    decision: Extract<CreatorVerificationStatus, 'approved' | 'rejected'>,
    reviewNote: string | null,
  ) {
    return transaction(async (txQuery) => {
      await requireAdministrator(txQuery, adminId, true)
      const rows = await txQuery(
        `select id, profile_id, verification_type, status, source
         from public.feature_verifications
         where id = $1
           and verification_type in ('recruiter', 'event_host')
         for update`,
        [verificationId],
      ) as LockedVerificationRow[]
      const verification = rows[0]
      if (!verification) throw new Error('verification_application_not_found')
      if (verification.status !== 'pending') throw new Error('verification_review_forbidden')

      await txQuery(
        `update public.feature_verifications
         set status = $2,
             reviewed_by = $3,
             reviewed_at = now(),
             review_note = $4,
             updated_at = now()
         where id = $1`,
        [verificationId, decision, adminId, reviewNote],
      )

      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, 'feature_verification', $3, $4::jsonb)`,
        [
          adminId,
          `verification.${decision}`,
          verificationId,
          JSON.stringify({
            verificationType: verification.verification_type,
            profileId: verification.profile_id,
            reviewNote,
          }),
        ],
      )

      return true
    })
  }

  return {
    getState,
    submitApplication,
    listAdminApplications,
    reviewApplication,
  }
}

export type CreatorVerificationRepository = ReturnType<typeof createCreatorVerificationRepository>

export const creatorVerificationRepository = createCreatorVerificationRepository()
