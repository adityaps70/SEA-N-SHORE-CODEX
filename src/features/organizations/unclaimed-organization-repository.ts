import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { listableOrganizationSql } from '@/features/profiles/organization-link-repository'
import { organizationLogoUrl, type LinkedOrganization } from '@/features/profiles/organization-link'
import { resolveOrganizationType } from './organization-types'
import {
  organizationDetailsFromInput,
  organizationTypeStoredLabel,
  parseOrganizationDetails,
  type ParsedOrganizationApplicationInput,
} from './schemas'
import type { OrganizationApplicationInput } from './types'
import {
  normalizeOrganizationName,
  organizationClaimStatusSql,
  unclaimedOrganizationSlug,
  unclaimedOrganizationTypeLabel,
  UNCLAIMED_ORGANIZATIONS_PER_DAY,
  type ParsedUnclaimedOrganizationInput,
} from './unclaimed-organization-policy'

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

/** Error codes thrown by this repository; the actions turn them into friendly messages. */
export type UnclaimedOrganizationErrorCode =
  | 'organization_duplicate_name'
  | 'organization_duplicate_in_review'
  | 'unclaimed_organization_rate_limited'
  | 'unclaimed_organization_create_failed'
  | 'organization_not_found'
  | 'organization_already_claimed'
  | 'organization_claim_in_review'
  | 'organization_claim_own_review'
  | 'organization_application_in_progress'
  | 'organization_claim_unavailable'

export class UnclaimedOrganizationError extends Error {
  constructor(
    readonly code: UnclaimedOrganizationErrorCode,
    /** For a duplicate name: the organization that already has it, when Sea N Shore lists it. */
    readonly existing: LinkedOrganization | null = null,
  ) {
    super(code)
    this.name = 'UnclaimedOrganizationError'
  }
}

type DuplicateRow = QueryResultRow & {
  id: string
  slug: string
  name: string
  has_logo: boolean | null
  is_verified: boolean | null
  claim_status: string | null
  listable: boolean | null
}

type ClaimTargetRow = QueryResultRow & {
  id: string
  slug: string
  name: string
  claim_status: string | null
  has_logo?: boolean | null
  company_type?: string | null
  organization_type?: string | null
  organization_details?: unknown
  website?: string | null
  office_locations?: string[] | null
  description?: string | null
  fleet_summary?: string | null
  vessel_types?: string[] | null
}

type ApplicationRow = QueryResultRow & {
  id: string
  status: string
  submitted_by: string
}

type IdRow = QueryResultRow & { id: string }
type SlugRow = QueryResultRow & { id: string; slug: string; name: string }
type CountRow = QueryResultRow & { total: string | number | null }

export type OrganizationNameConflict =
  | { kind: 'listed'; organization: LinkedOrganization }
  | { kind: 'in_review' }

/** A page someone can claim, with its current details to prefill the claim form. */
export type ClaimableOrganization = {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  unclaimed: boolean
  prefill: OrganizationApplicationInput
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values)).rows))
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505'
}

function mapLinked(row: Pick<DuplicateRow, 'id' | 'slug' | 'name' | 'has_logo' | 'is_verified' | 'claim_status'>): LinkedOrganization {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    logoUrl: organizationLogoUrl(row.id, row.has_logo === true),
    verified: row.is_verified === true,
    unclaimed: row.claim_status === 'unclaimed',
  }
}

/** Any organization, listed or in review, whose name matches (case-insensitive, spaces collapsed). */
async function findDuplicate(query: Query, name: string, excludeId?: string): Promise<DuplicateRow | null> {
  const rows = await query(
    `select
       c.id,
       c.slug,
       c.name,
       (c.logo_path is not null and btrim(c.logo_path) <> '') as has_logo,
       coalesce(c.is_verified, false) as is_verified,
       ${organizationClaimStatusSql('c')} as claim_status,
       ${listableOrganizationSql('c')} as listable
     from public.companies c
     where lower(btrim(c.name)) = lower($1)
       and ($2::uuid is null or c.id <> $2::uuid)
     order by ${listableOrganizationSql('c')} desc, coalesce(c.is_verified, false) desc, c.created_at asc
     limit 1`,
    [name, excludeId ?? null],
  ) as DuplicateRow[]
  return rows[0] ?? null
}

function duplicateError(row: DuplicateRow) {
  return row.listable
    ? new UnclaimedOrganizationError('organization_duplicate_name', mapLinked(row))
    : new UnclaimedOrganizationError('organization_duplicate_in_review')
}

export function createUnclaimedOrganizationRepository(input: {
  query?: Query
  transaction?: Transaction
  slug?: (name: string) => string
} = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction
  const slugFor = input.slug ?? ((name: string) => unclaimedOrganizationSlug(name))

  /**
   * Another organization with exactly this name (case-insensitive): a listed page
   * to choose or claim instead, or one still waiting for Sea N Shore review.
   */
  async function findNameConflict(name: string): Promise<OrganizationNameConflict | null> {
    const normalized = normalizeOrganizationName(name)
    if (normalized.length < 2) return null
    const row = await findDuplicate(query, normalized)
    if (!row) return null
    return row.listable ? { kind: 'listed', organization: mapLinked(row) } : { kind: 'in_review' }
  }

  /**
   * "I just work there": adds an unclaimed organization. Refuses a name that any
   * organization already has (case-insensitive) and limits how many pages one
   * member can add in a day.
   */
  async function createUnclaimedOrganization(userId: string, data: ParsedUnclaimedOrganizationInput): Promise<LinkedOrganization> {
    const name = normalizeOrganizationName(data.name)
    try {
      return await transaction(async (txQuery) => {
        // Serialize concurrent adds of the same name; the unique index is the final guard.
        await txQuery(`select pg_advisory_xact_lock(hashtext('unclaimed-organization:' || lower($1)))`, [name])

        const duplicate = await findDuplicate(txQuery, name)
        if (duplicate) throw duplicateError(duplicate)

        const recentRows = await txQuery(
          `select count(*) as total
           from public.companies c
           where c.created_by = $1
             and ${organizationClaimStatusSql('c')} = 'unclaimed'
             and c.created_at > now() - interval '1 day'`,
          [userId],
        ) as CountRow[]
        if (Number(recentRows[0]?.total ?? 0) >= UNCLAIMED_ORGANIZATIONS_PER_DAY) {
          throw new UnclaimedOrganizationError('unclaimed_organization_rate_limited')
        }

        const rows = await txQuery(
          `insert into public.companies (
             slug, name, company_type, organization_type, website, office_locations,
             created_by, claim_status, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6::text[], $7, 'unclaimed', now(), now())
           returning id, slug, name`,
          [
            slugFor(name),
            name,
            unclaimedOrganizationTypeLabel(data.organizationType),
            data.organizationType,
            data.website,
            [data.location],
            userId,
          ],
        ) as SlugRow[]
        const company = rows[0]
        if (!company) throw new UnclaimedOrganizationError('unclaimed_organization_create_failed')

        await txQuery(
          `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
           values ($1, 'organization.unclaimed_created', 'company', $2, $3::jsonb)`,
          [userId, company.id, JSON.stringify({ name: company.name, organizationType: data.organizationType })],
        )

        return {
          id: company.id,
          slug: company.slug,
          name: company.name,
          logoUrl: null,
          verified: false,
          unclaimed: true,
        }
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        const duplicate = await findDuplicate(query, name).catch(() => null)
        throw duplicate ? duplicateError(duplicate) : new UnclaimedOrganizationError('organization_duplicate_in_review')
      }
      throw error
    }
  }

  /** The organization behind a claim page, only while it is unclaimed and listed. */
  async function getClaimableOrganization(slug: string): Promise<ClaimableOrganization | null> {
    const rows = await query(
      `select
         c.id, c.slug, c.name,
         (c.logo_path is not null and btrim(c.logo_path) <> '') as has_logo,
         c.company_type, c.organization_type, c.organization_details, c.website,
         c.office_locations, c.description, c.fleet_summary, c.vessel_types,
         ${organizationClaimStatusSql('c')} as claim_status
       from public.companies c
       where c.slug = $1
         and ${listableOrganizationSql('c')}
       limit 1`,
      [slug],
    ) as ClaimTargetRow[]
    const row = rows[0]
    if (!row) return null
    const type = resolveOrganizationType(row.organization_type ?? null, row.company_type ?? null)
    const details = parseOrganizationDetails(row.organization_details)
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      logoUrl: organizationLogoUrl(row.id, row.has_logo === true),
      unclaimed: row.claim_status === 'unclaimed',
      prefill: {
        organizationName: row.name,
        organizationType: type.code,
        organizationTypeOther: type.otherLabel,
        website: row.website ?? null,
        officialEmail: '',
        officeLocation: Array.isArray(row.office_locations) ? row.office_locations[0] ?? '' : '',
        description: row.description ?? '',
        fleetSize: details.fleetSize ?? null,
        fleetSummary: row.fleet_summary ?? null,
        vesselTypes: Array.isArray(row.vessel_types) ? row.vessel_types : [],
        recruitmentLicence: details.recruitmentLicence ?? null,
        servicesOffered: details.servicesOffered ?? [],
        languages: details.languages ?? [],
        helpline24x7: details.helpline24x7 ?? null,
        accreditation: details.accreditation ?? null,
        applicantRole: '',
        registrationReference: null,
        supportingNotes: null,
      },
    }
  }

  /**
   * "Claim this page": the same verification review as registering a new
   * organization. The claimant becomes the (unapproved) owner, the page details
   * are updated from the form and an organization application of kind 'claim'
   * goes to Sea N Shore. Approving it verifies the organization, and migration
   * 0050's trigger then marks the page claimed.
   */
  async function submitClaim(userId: string, companyId: string, data: ParsedOrganizationApplicationInput) {
    return transaction(async (txQuery) => {
      const companyRows = await txQuery(
        `select c.id, c.slug, c.name, ${organizationClaimStatusSql('c')} as claim_status
         from public.companies c
         where c.id = $1
         for update`,
        [companyId],
      ) as ClaimTargetRow[]
      const company = companyRows[0]
      if (!company) throw new UnclaimedOrganizationError('organization_not_found')
      if (company.claim_status !== 'unclaimed') throw new UnclaimedOrganizationError('organization_already_claimed')

      // One organization review at a time per member, as for registration.
      const ownRows = await txQuery(
        `select id, status, submitted_by
         from public.organization_applications
         where submitted_by = $1
           and company_id <> $2
           and status <> 'approved'
         limit 1`,
        [userId, companyId],
      ) as ApplicationRow[]
      if (ownRows[0]) throw new UnclaimedOrganizationError('organization_application_in_progress')

      const existingRows = await txQuery(
        `select id, status, submitted_by
         from public.organization_applications
         where company_id = $1
         for update`,
        [companyId],
      ) as ApplicationRow[]
      const existing = existingRows[0] ?? null
      if (existing && (existing.status === 'pending' || existing.status === 'changes_requested')) {
        throw new UnclaimedOrganizationError(existing.submitted_by === userId ? 'organization_claim_own_review' : 'organization_claim_in_review')
      }
      if (existing && existing.status !== 'rejected') throw new UnclaimedOrganizationError('organization_claim_unavailable')

      const name = normalizeOrganizationName(data.organizationName)
      const duplicate = await findDuplicate(txQuery, name, companyId)
      if (duplicate) throw duplicateError(duplicate)

      await txQuery(
        `update public.companies
         set name = $2,
             company_type = $3,
             website = $4,
             description = $5,
             fleet_summary = $6,
             vessel_types = $7::text[],
             office_locations = $8::text[],
             organization_type = $9,
             organization_details = $10::jsonb,
             updated_at = now()
         where id = $1`,
        [
          companyId,
          name,
          organizationTypeStoredLabel(data),
          data.website,
          data.description,
          data.fleetSummary,
          data.vesselTypes,
          [data.officeLocation],
          data.organizationType,
          JSON.stringify(organizationDetailsFromInput(data)),
        ],
      )

      if (existing && existing.submitted_by !== userId) {
        // An earlier claim was not approved; that claimant's unapproved ownership ends here.
        await txQuery(
          `delete from public.company_members
           where company_id = $1 and user_id = $2 and approved_at is null and role::text = 'owner'`,
          [companyId, existing.submitted_by],
        )
      }

      await txQuery(
        `insert into public.company_members (company_id, user_id, role, approved_at, created_at)
         values ($1, $2, 'owner'::public.company_member_role, null, now())
         on conflict (company_id, user_id) do update set
           role = 'owner'::public.company_member_role,
           approved_at = null`,
        [companyId, userId],
      )

      const values = [
        companyId,
        userId,
        data.officialEmail.toLowerCase(),
        data.registrationReference,
        data.applicantRole,
        data.supportingNotes,
      ]
      const applicationRows = existing
        ? await txQuery(
            `update public.organization_applications
             set submitted_by = $2,
                 status = 'pending',
                 request_kind = 'claim',
                 official_email = $3,
                 registration_reference = $4,
                 applicant_role = $5,
                 supporting_notes = $6,
                 submitted_at = now(),
                 updated_at = now(),
                 reviewed_by = null,
                 reviewed_at = null,
                 admin_review_note = null
             where company_id = $1
             returning id`,
            values,
          ) as IdRow[]
        : await txQuery(
            `insert into public.organization_applications (
               company_id, submitted_by, status, request_kind, official_email, registration_reference,
               applicant_role, supporting_notes, submitted_at, updated_at
             ) values ($1, $2, 'pending', 'claim', $3, $4, $5, $6, now(), now())
             returning id`,
            values,
          ) as IdRow[]
      const application = applicationRows[0]
      if (!application) throw new UnclaimedOrganizationError('organization_claim_unavailable')

      await txQuery(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'organization.claim_submitted', 'organization_application', $2, $3::jsonb)`,
        [userId, application.id, JSON.stringify({ companyId, previousApplicationStatus: existing?.status ?? null })],
      )

      return { applicationId: application.id, companyId, slug: company.slug }
    })
  }

  return { findNameConflict, createUnclaimedOrganization, getClaimableOrganization, submitClaim }
}

export type UnclaimedOrganizationRepository = ReturnType<typeof createUnclaimedOrganizationRepository>

export const unclaimedOrganizationRepository = createUnclaimedOrganizationRepository()
