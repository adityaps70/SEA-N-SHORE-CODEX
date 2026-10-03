import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { legacyProfileTypeForPersona, type Persona, type ProfileIntent } from '@/features/profiles/persona'

export type LegacyOrganizationSnapshot = {
  name: string
  headline: string | null
  summary: string | null
  location: string | null
  avatarPath: string | null
}

export type LegacyOrganizationConversionState = {
  status: 'pending' | 'completed'
  legacyOrganization: LegacyOrganizationSnapshot
  linkedCompanyId: string | null
  completedAt: string | null
  eligibleOrganizations: Array<{
    id: string
    name: string
    slug: string
    verified: boolean
    role: 'owner' | 'administrator'
  }>
}

export type LegacyOrganizationConversionInput = {
  fullName: string
  persona: Persona
  profileIntents: ProfileIntent[]
  headline: string
  strategy: 'existing' | 'create'
  companyId: string | null
  newOrganizationName: string | null
}

type LegacyQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type LegacyTransaction = <T>(work: (query: LegacyQuery) => Promise<T>) => Promise<T>

type ConversionRow = QueryResultRow & {
  profile_id: string
  status: string
  legacy_snapshot: Record<string, unknown>
  company_id: string | null
  completed_at: string | null
}

type EligibleCompanyRow = QueryResultRow & {
  company_id: string
  company_name: string
  company_slug: string
  company_verified: boolean | null
  member_role: string
}

type MembershipRow = QueryResultRow & {
  role: string
  approved_at: string | null
}

type ReturningIdRow = QueryResultRow & {
  id: string
}

function runtimeTransaction<T>(work: (query: LegacyQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function snapshotText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function mapSnapshot(value: Record<string, unknown>): LegacyOrganizationSnapshot {
  return {
    name: snapshotText(value.organizationName) ?? 'Legacy organization',
    headline: snapshotText(value.headline),
    summary: snapshotText(value.summary),
    location: snapshotText(value.location),
    avatarPath: snapshotText(value.avatarPath),
  }
}

function companySlug(name: string, profileId: string) {
  const suffix = `legacy-${profileId.replace(/-/g, '').slice(0, 8).toLowerCase() || 'company'}`
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'organization'
  const maximumBaseLength = Math.max(1, 80 - suffix.length - 1)
  return `${base.slice(0, maximumBaseLength).replace(/-+$/g, '')}-${suffix}`
}

function defaultHeadline(input: LegacyOrganizationConversionInput) {
  const explicit = input.headline.trim()
  if (explicit) return explicit
  if (input.persona === 'recruiter_hr') return 'Recruiter / HR'
  if (input.persona === 'trainer_instructor') return 'Trainer / Instructor'
  if (input.persona === 'student_cadet') return 'Student / Cadet'
  if (input.persona === 'seafarer_family') return 'Seafarer Family'
  if (input.persona === 'maritime_enthusiast') return 'Maritime Enthusiast'
  if (input.persona === 'seafarer') return 'Seafarer'
  if (input.persona === 'shore_professional') return 'Shore Professional'
  return 'Maritime Professional'
}

export function createLegacyOrganizationConversionRepository(input: {
  query?: LegacyQuery
  transaction?: LegacyTransaction
} = {}) {
  const queryRows: LegacyQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function getConversion(profileId: string): Promise<LegacyOrganizationConversionState | null> {
    const conversionRows = await queryRows(
      `select profile_id, status, legacy_snapshot, company_id, completed_at
       from public.legacy_organization_conversions
       where profile_id = $1
       limit 1`,
      [profileId],
    ) as ConversionRow[]
    const conversion = conversionRows[0]
    if (!conversion) return null

    const companyRows = await queryRows(
      `select
         c.id as company_id,
         c.name as company_name,
         c.slug as company_slug,
         coalesce(c.is_verified, false) as company_verified,
         cm.role::text as member_role
       from public.company_members cm
       join public.companies c on c.id = cm.company_id
       where cm.user_id = $1
         and cm.approved_at is not null
         and cm.role::text in ('owner', 'administrator')
       order by c.name asc, c.id asc`,
      [profileId],
    ) as EligibleCompanyRow[]

    return {
      status: conversion.status === 'completed' ? 'completed' : 'pending',
      legacyOrganization: mapSnapshot(conversion.legacy_snapshot ?? {}),
      linkedCompanyId: conversion.company_id ?? null,
      completedAt: conversion.completed_at ?? null,
      eligibleOrganizations: companyRows.map((row) => ({
        id: row.company_id,
        name: row.company_name,
        slug: row.company_slug,
        verified: Boolean(row.company_verified),
        role: row.member_role === 'owner' ? 'owner' : 'administrator',
      })),
    }
  }

  async function completeConversion(profileId: string, data: LegacyOrganizationConversionInput) {
    return transaction(async (txQuery) => {
      const conversionRows = await txQuery(
        `select profile_id, status, legacy_snapshot, company_id, completed_at
         from public.legacy_organization_conversions
         where profile_id = $1
         for update`,
        [profileId],
      ) as ConversionRow[]
      const conversion = conversionRows[0]
      if (!conversion) throw new Error('legacy_conversion_not_required')
      if (conversion.status === 'completed') throw new Error('legacy_conversion_completed')

      const snapshot = mapSnapshot(conversion.legacy_snapshot ?? {})
      let companyId: string

      if (data.strategy === 'existing') {
        if (!data.companyId) throw new Error('legacy_company_required')
        const membershipRows = await txQuery(
          `select role::text as role, approved_at
           from public.company_members
           where company_id = $1 and user_id = $2
           for update`,
          [data.companyId, profileId],
        ) as MembershipRow[]
        const membership = membershipRows[0]
        if (
          !membership
          || !membership.approved_at
          || !['owner', 'administrator'].includes(membership.role)
        ) {
          throw new Error('legacy_company_admin_required')
        }
        companyId = data.companyId

        await txQuery(
          `update public.companies
           set logo_path = coalesce(logo_path, $2),
               description = coalesce(description, $3),
               company_type = coalesce(company_type, $4),
               office_locations = case
                 when cardinality(office_locations) = 0 and $5 is not null then array[$5]::text[]
                 else office_locations
               end,
               updated_at = now()
           where id = $1`,
          [
            companyId,
            snapshot.avatarPath,
            snapshot.summary,
            snapshot.headline,
            snapshot.location,
          ],
        )
      } else {
        const organizationName = data.newOrganizationName?.trim()
        if (!organizationName) throw new Error('legacy_company_name_required')

        const duplicateRows = await txQuery(
          `select id
           from public.companies
           where lower(name) = lower($1)
           limit 1`,
          [organizationName],
        ) as ReturningIdRow[]
        if (duplicateRows[0]) throw new Error('legacy_company_already_exists')

        const companyRows = await txQuery(
          `insert into public.companies (
             slug, name, logo_path, company_type, description, office_locations,
             created_by, created_at, updated_at
           )
           values ($1, $2, $3, $4, $5, $6::text[], $7, now(), now())
           returning id`,
          [
            companySlug(organizationName, profileId),
            organizationName,
            snapshot.avatarPath,
            snapshot.headline,
            snapshot.summary,
            snapshot.location ? [snapshot.location] : [],
            profileId,
          ],
        ) as ReturningIdRow[]
        const company = companyRows[0]
        if (!company) throw new Error('legacy_company_create_failed')
        companyId = company.id

        await txQuery(
          `insert into public.company_members (
             company_id, user_id, role, approved_at, created_at
           )
           values ($1, $2, $3::public.company_member_role, now(), now())
           on conflict (company_id, user_id)
           do update set
             role = 'owner'::public.company_member_role,
             approved_at = coalesce(public.company_members.approved_at, now())`,
          [companyId, profileId, 'owner'],
        )
      }

      const profileType = legacyProfileTypeForPersona(data.persona)
      await txQuery(
        `update public.profiles
         set full_name = $2,
             persona = $3,
             profile_intents = $4::text[],
             profile_type = $5::public.profile_type,
             headline = $6,
             summary = null,
             avatar_path = null,
             identity_root = null,
             primary_identity = null,
             primary_identity_family = null,
             secondary_identities = '{}'::text[],
             updated_at = now()
         where id = $1
           and account_status = 'active'`,
        [
          profileId,
          data.fullName.trim(),
          data.persona,
          data.profileIntents,
          profileType,
          defaultHeadline(data),
        ],
      )

      await txQuery(
        `update public.legacy_organization_conversions
         set status = 'completed',
             strategy = $2,
             company_id = $3,
             completed_at = now(),
             updated_at = now()
         where profile_id = $1`,
        [profileId, data.strategy, companyId],
      )

      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'legacy_organization.converted', 'user_account', $1, $2::jsonb)`,
        [
          profileId,
          JSON.stringify({
            companyId,
            strategy: data.strategy,
            legacyOrganizationName: snapshot.name,
            persona: data.persona,
          }),
        ],
      )

      return { companyId }
    })
  }

  return {
    getConversion,
    completeConversion,
  }
}

export type LegacyOrganizationConversionRepository = ReturnType<typeof createLegacyOrganizationConversionRepository>

export const legacyOrganizationConversionRepository = createLegacyOrganizationConversionRepository()
