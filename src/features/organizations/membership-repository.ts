import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'

/**
 * Round F (F2): a member leaving an organization, and an owner handing the organization to an
 * administrator. Every approved member may leave, whatever their role; the organization always
 * keeps at least one approved owner, so its last owner transfers ownership first.
 */

type MembershipTransaction = <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => Promise<T>

export type LeaveOrganizationState = {
  companyId: string
  slug: string
  name: string
  role: string
  /** The only approved owner: they must transfer ownership before they can leave. */
  lastOwner: boolean
  /** Approved administrators the owner can hand the organization to (owners only). */
  administrators: Array<{ profileId: string; fullName: string }>
}

export type LeftOrganization = {
  companyId: string
  slug: string
  previousRole: string
  /** Owners and administrators told about it in-app. */
  notified: number
}

type MemberRow = { user_id: string; role: string }

export function createOrganizationMembershipRepository(input: { transaction?: MembershipTransaction } = {}) {
  const transaction: MembershipTransaction = input.transaction ?? databaseTransaction

  /** What the leave dialog needs; null when the person is not an approved member. */
  async function getLeaveState(profileId: string, companyId: string): Promise<LeaveOrganizationState | null> {
    return transaction(async (client) => {
      const company = await client.query<{ id: string; slug: string; name: string }>(
        `select id, slug, name from public.companies where id = $1`,
        [companyId],
      )
      if (!company.rows[0]) return null
      const members = await client.query<MemberRow & { full_name: string }>(
        `select member.user_id, member.role::text as role, profile.full_name
         from public.company_members member
         join public.profiles profile on profile.id = member.user_id
         where member.company_id = $1 and member.approved_at is not null
         order by profile.full_name asc, profile.id asc`,
        [companyId],
      )
      const me = members.rows.find((row) => row.user_id === profileId)
      if (!me) return null
      const owners = members.rows.filter((row) => row.role === 'owner').length
      return {
        companyId,
        slug: company.rows[0].slug,
        name: company.rows[0].name,
        role: me.role,
        lastOwner: me.role === 'owner' && owners <= 1,
        administrators: me.role === 'owner'
          ? members.rows
            .filter((row) => row.role === 'administrator' && row.user_id !== profileId)
            .map((row) => ({ profileId: row.user_id, fullName: row.full_name }))
          : [],
      }
    })
  }

  /**
   * Leaves the organization. In one transaction: the membership and role go (so every workspace
   * tool, which re-reads company_members, stops at once), pending access requests for this
   * organization are withdrawn, the profile stops naming it as the current organization, a
   * recruiter verification that only came from organization membership is suspended when no
   * qualifying membership remains, an audit row is written (member id, organization, previous role),
   * and the remaining owners and administrators get an in-app notice.
   */
  async function leave(profileId: string, companyId: string): Promise<LeftOrganization> {
    return transaction(async (client) => {
      // Lock the organization's approved memberships so two leaves cannot both pass the last-owner check.
      const members = await client.query<MemberRow>(
        `select user_id, role::text as role
         from public.company_members
         where company_id = $1 and approved_at is not null
         for update`,
        [companyId],
      )
      const me = members.rows.find((row) => row.user_id === profileId)
      if (!me) throw new Error('organization_member_not_found')
      if (me.role === 'owner' && members.rows.filter((row) => row.role === 'owner').length <= 1) {
        throw new Error('organization_last_owner')
      }

      const removed = await client.query<{ user_id: string }>(
        `delete from public.company_members
         where company_id = $1 and user_id = $2 and approved_at is not null
         returning user_id`,
        [companyId, profileId],
      )
      if (!removed.rows[0]) throw new Error('organization_member_not_found')

      await client.query(
        `update public.company_access_requests
         set status = 'cancelled', reviewed_at = now()
         where company_id = $1 and user_id = $2 and status = 'pending'`,
        [companyId, profileId],
      )
      await client.query(
        `update public.maritime_profiles
         set current_company_id = null, current_company = null
         where user_id = $1 and current_company_id = $2`,
        [profileId, companyId],
      )
      await client.query(
        `update public.feature_verifications verification
         set status = 'suspended',
             review_note = 'Ended when the member left the organization that granted it.',
             updated_at = now()
         where verification.profile_id = $1
           and verification.verification_type = 'recruiter'
           and verification.source = 'company_membership'
           and verification.status = 'approved'
           and not exists (
             select 1
             from public.company_members other
             join public.companies other_company on other_company.id = other.company_id
             where other.user_id = $1
               and other.approved_at is not null
               and other.role::text in ('owner', 'administrator', 'recruiter')
               and coalesce(other_company.is_verified, false)
           )`,
        [profileId],
      )
      await client.query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'organization.member_left', 'company', $2, $3::jsonb)`,
        [profileId, companyId, JSON.stringify({ previousRole: me.role })],
      )
      const notified = await client.query<{ id: string }>(
        `insert into public.notifications (recipient_id, actor_id, notification_type, company_id, dedupe_key)
         select member.user_id, $1::uuid, 'organization_member_left', $2::uuid,
                concat('organization-left:', $2::uuid, ':', $1::uuid, ':', floor(extract(epoch from now()))::bigint)
         from public.company_members member
         join public.profiles admin_profile on admin_profile.id = member.user_id and admin_profile.account_status = 'active'
         where member.company_id = $2::uuid
           and member.approved_at is not null
           and member.role::text in ('owner', 'administrator')
         on conflict do nothing
         returning id`,
        [profileId, companyId],
      )
      const company = await client.query<{ slug: string }>(`select slug from public.companies where id = $1`, [companyId])
      return { companyId, slug: company.rows[0]?.slug ?? '', previousRole: me.role, notified: notified.rows.length }
    })
  }

  /**
   * Hands the organization to an approved administrator: they become an owner and the current owner
   * becomes an administrator (they can then leave). Only an approved owner can do this.
   */
  async function transferOwnership(ownerId: string, companyId: string, newOwnerId: string) {
    if (ownerId === newOwnerId) throw new Error('organization_transfer_invalid')
    return transaction(async (client) => {
      const members = await client.query<MemberRow>(
        `select user_id, role::text as role
         from public.company_members
         where company_id = $1 and approved_at is not null
         for update`,
        [companyId],
      )
      const owner = members.rows.find((row) => row.user_id === ownerId)
      if (!owner || owner.role !== 'owner') throw new Error('organization_transfer_forbidden')
      const target = members.rows.find((row) => row.user_id === newOwnerId)
      if (!target || target.role !== 'administrator') throw new Error('organization_transfer_target_invalid')

      await client.query(
        `update public.company_members set role = 'owner'::public.company_member_role
         where company_id = $1 and user_id = $2 and approved_at is not null`,
        [companyId, newOwnerId],
      )
      await client.query(
        `update public.company_members set role = 'administrator'::public.company_member_role
         where company_id = $1 and user_id = $2 and approved_at is not null`,
        [companyId, ownerId],
      )
      await client.query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'organization.ownership_transferred', 'company', $2, $3::jsonb)`,
        [ownerId, companyId, JSON.stringify({ newOwnerId, previousOwnerRole: 'administrator' })],
      )
      return true
    })
  }

  return { getLeaveState, leave, transferOwnership }
}

export const organizationMembershipRepository = createOrganizationMembershipRepository()
