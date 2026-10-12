'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { organizationMembershipRepository, type LeaveOrganizationState } from './membership-repository'

/**
 * Round F (F2): leave an organization (any approved member, any role) and hand it to an
 * administrator (owners). The repository re-checks everything inside its transaction.
 */

const companySchema = z.object({ companyId: z.string().uuid() })
const transferSchema = z.object({ companyId: z.string().uuid(), newOwnerId: z.string().uuid() })

export type LeaveStateResult =
  | { ok: true; state: LeaveOrganizationState }
  | { ok: false; error: string }

export type MembershipActionResult =
  | { ok: true }
  | { ok: false; error: string; code?: 'last_owner' }

function refreshAfterMembershipChange(slug: string) {
  revalidatePath('/organizations')
  if (slug) {
    revalidatePath(`/organizations/${slug}`)
    revalidatePath(`/organizations/${slug}/manage`)
    revalidatePath(`/organizations/${slug}/team`)
  }
  revalidatePath('/home')
  revalidatePath('/profile')
  revalidatePath('/hiring')
  revalidatePath('/events/hosting')
  revalidatePath('/learn/studio')
}

/** What the leave dialog shows: the role, and for the last owner the administrators to hand over to. */
export async function getLeaveOrganizationState(input: { companyId: string }): Promise<LeaveStateResult> {
  const parsed = companySchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'This organization could not be found.' }
  try {
    const user = await requireAwsUser()
    const state = await organizationMembershipRepository.getLeaveState(user.id, parsed.data.companyId)
    return state ? { ok: true, state } : { ok: false, error: 'You are not a member of this organization any more.' }
  } catch {
    return { ok: false, error: 'We could not load this organization. Please try again.' }
  }
}

export async function leaveOrganization(input: { companyId: string }): Promise<MembershipActionResult> {
  const parsed = companySchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'This organization could not be found.' }
  try {
    const user = await requireAwsUser()
    const left = await organizationMembershipRepository.leave(user.id, parsed.data.companyId)
    refreshAfterMembershipChange(left.slug)
    return { ok: true }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'organization_last_owner') {
      return { ok: false, code: 'last_owner', error: 'You are the only owner. Transfer ownership to an administrator first.' }
    }
    if (code === 'organization_member_not_found') return { ok: false, error: 'You are not a member of this organization any more.' }
    return { ok: false, error: 'We could not take you out of this organization. Please try again.' }
  }
}

export async function transferOrganizationOwnership(input: { companyId: string; newOwnerId: string }): Promise<MembershipActionResult> {
  const parsed = transferSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Choose an administrator to hand the organization to.' }
  try {
    const user = await requireAwsUser()
    await organizationMembershipRepository.transferOwnership(user.id, parsed.data.companyId, parsed.data.newOwnerId)
    const state = await organizationMembershipRepository.getLeaveState(user.id, parsed.data.companyId).catch(() => null)
    refreshAfterMembershipChange(state?.slug ?? '')
    return { ok: true }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'organization_transfer_forbidden') return { ok: false, error: 'Only an owner can transfer ownership.' }
    if (code === 'organization_transfer_target_invalid' || code === 'organization_transfer_invalid') {
      return { ok: false, error: 'Choose a current administrator of this organization.' }
    }
    return { ok: false, error: 'We could not transfer ownership. Please try again.' }
  }
}
