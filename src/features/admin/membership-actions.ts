'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { CAPABILITIES } from '@/features/access/policy'
import { adminMembershipRepository } from './membership-repository'

const reasonSchema = z.string()
  .trim()
  .min(5, 'Add a clear reason for this entitlement action.')
  .max(1000, 'Keep the reason to 1,000 characters or fewer.')

const grantSchema = z.object({
  subjectType: z.enum(['profile', 'company']),
  subjectId: z.string().uuid(),
  capability: z.enum(CAPABILITIES),
  reason: reasonSchema,
})

const revokeSchema = z.object({
  grantId: z.string().uuid(),
  reason: reasonSchema,
})

export type AdminEntitlementActionResult =
  | { ok: true; grantId?: string }
  | { ok: false; error: string }

function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'admin_forbidden') return 'You do not have permission to manage entitlements.'
  if (code === 'admin_entitlement_capability_forbidden') return 'This capability cannot be granted manually for that subject.'
  if (code === 'admin_entitlement_already_active') return 'That entitlement is already active for this subject.'
  if (code === 'admin_entitlement_grant_not_found') return 'This entitlement is unavailable or has already been revoked.'
  if (code === 'admin_entitlement_reason_required') return 'Add a reason for this entitlement action.'
  return 'The entitlement change could not be saved. Please try again.'
}

export async function grantAdminEntitlement(input: {
  subjectType: 'profile' | 'company'
  subjectId: string
  capability: (typeof CAPABILITIES)[number]
  reason: string
}): Promise<AdminEntitlementActionResult> {
  const parsed = grantSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Check the entitlement grant and try again.',
    }
  }

  try {
    const admin = await requireAwsUser()
    const result = await adminMembershipRepository.grantEntitlement(admin.id, parsed.data)

    revalidatePath('/admin')
    if (parsed.data.subjectType === 'profile') {
      revalidatePath(`/admin/users/${parsed.data.subjectId}`)
      revalidatePath('/admin/users')
    } else {
      revalidatePath('/admin/organizations')
      revalidatePath('/admin/organizations/[applicationId]', 'page')
    }
    return { ok: true, grantId: result.grantId }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

export async function revokeAdminEntitlement(
  grantId: string,
  reason: string,
): Promise<AdminEntitlementActionResult> {
  const parsed = revokeSchema.safeParse({ grantId, reason })
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Check the entitlement revocation and try again.',
    }
  }

  try {
    const admin = await requireAwsUser()
    await adminMembershipRepository.revokeEntitlement(admin.id, parsed.data.grantId, parsed.data.reason)

    revalidatePath('/admin')
    revalidatePath('/admin/users/[profileId]', 'page')
    revalidatePath('/admin/organizations/[applicationId]', 'page')
    revalidatePath('/admin/users')
    revalidatePath('/admin/organizations')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}
