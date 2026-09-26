'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireCapability } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import type { OrganizationAccessRole } from '@/features/access/policy'
import { deleteMediaObject, putMediaObject } from '@/lib/aws/storage'
import { organizationWorkspaceRepository } from './workspace-repository'

const uuidSchema = z.string().uuid()
const assignableRoles = [
  'administrator',
  'recruiter',
  'lms_manager',
  'event_manager',
  'content_manager',
  'analyst',
  'member',
] as const satisfies readonly Exclude<OrganizationAccessRole, 'owner'>[]

const memberRoleSchema = z.object({
  companyId: uuidSchema,
  memberId: uuidSchema,
  role: z.enum(assignableRoles),
})

const brandingSchema = z.object({
  companyId: uuidSchema,
  website: z.preprocess(
    (value) => typeof value === 'string' && value.trim() ? value.trim() : null,
    z.string().url('Enter a valid organization website.').max(320).nullable(),
  ),
  description: z.preprocess(
    (value) => typeof value === 'string' && value.trim() ? value.trim() : null,
    z.string().max(4000, 'Keep the description to 4,000 characters or fewer.').nullable(),
  ),
  fleetSummary: z.preprocess(
    (value) => typeof value === 'string' && value.trim() ? value.trim() : null,
    z.string().max(2000, 'Keep the operations summary to 2,000 characters or fewer.').nullable(),
  ),
  vesselTypes: z.preprocess(
    (value) => typeof value === 'string'
      ? value.split(',').map((entry) => entry.trim()).filter(Boolean)
      : [],
    z.array(z.string().min(1).max(100)).max(30),
  ),
  officeLocations: z.preprocess(
    (value) => typeof value === 'string'
      ? value.split(',').map((entry) => entry.trim()).filter(Boolean)
      : [],
    z.array(z.string().min(1).max(160)).max(20),
  ),
})

const logoTypes: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_LOGO_BYTES = 5 * 1024 * 1024

export type OrganizationWorkspaceActionResult =
  | { ok: true }
  | { ok: false; error: string }

export type OrganizationBrandingActionState = {
  success?: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
}

function workspacePath(slug: string) {
  return `/organizations/${slug}`
}

function refreshOrganizationWorkspace(slug: string) {
  revalidatePath('/organizations')
  revalidatePath(workspacePath(slug))
  revalidatePath(`${workspacePath(slug)}/team`)
  revalidatePath(`${workspacePath(slug)}/branding`)
  revalidatePath(`${workspacePath(slug)}/analytics`)
  revalidatePath('/hiring')
  revalidatePath('/events/hosting')
  revalidatePath('/learn/studio')
}

export async function updateOrganizationMemberRole(input: {
  companyId: string
  memberId: string
  role: Exclude<OrganizationAccessRole, 'owner'>
}): Promise<OrganizationWorkspaceActionResult> {
  const parsed = memberRoleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Choose a valid organization team role.' }

  try {
    const user = await requireAwsUser()
    await requireCapability(user.id, 'organization.team', { companyId: parsed.data.companyId })
    const workspace = await organizationWorkspaceRepository.getById(parsed.data.companyId)
    if (!workspace) return { ok: false, error: 'This organization workspace could not be found.' }

    await organizationWorkspaceRepository.updateMemberRole(
      user.id,
      parsed.data.companyId,
      parsed.data.memberId,
      parsed.data.role,
    )
    refreshOrganizationWorkspace(workspace.slug)
    return { ok: true }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'capability_required') {
      return { ok: false, error: 'Organization Pro team-management access is required to change member roles.' }
    }
    if (code === 'organization_owner_role_locked') {
      return { ok: false, error: 'The organization owner role cannot be changed from team management.' }
    }
    if (code === 'organization_member_not_found') {
      return { ok: false, error: 'This organization member could not be found.' }
    }
    return { ok: false, error: 'We could not update this team role. Please try again.' }
  }
}

export async function updateOrganizationBranding(
  _previousState: OrganizationBrandingActionState,
  formData: FormData,
): Promise<OrganizationBrandingActionState> {
  const parsed = brandingSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return {
      error: 'Please correct the highlighted organization information.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  try {
    const user = await requireAwsUser()
    await requireCapability(user.id, 'organization.branding', { companyId: parsed.data.companyId })
    const workspace = await organizationWorkspaceRepository.getById(parsed.data.companyId)
    if (!workspace) return { error: 'This organization workspace could not be found.' }

    const logo = formData.get('logo')
    let nextLogoPath: string | null = null
    let newLogoUploaded = false

    if (logo instanceof File && logo.size > 0) {
      const extension = logoTypes[logo.type]
      if (!extension || logo.size > MAX_LOGO_BYTES) {
        return { error: 'Organization logo must be a JPG, PNG or WebP image up to 5 MB.' }
      }
      nextLogoPath = `organizations/${parsed.data.companyId}/logo-${randomUUID()}.${extension}`
      await putMediaObject({
        key: nextLogoPath,
        body: new Uint8Array(await logo.arrayBuffer()),
        contentType: logo.type,
      })
      newLogoUploaded = true
    }

    try {
      await organizationWorkspaceRepository.updateBranding(parsed.data.companyId, {
        website: parsed.data.website,
        description: parsed.data.description,
        fleetSummary: parsed.data.fleetSummary,
        vesselTypes: parsed.data.vesselTypes,
        officeLocations: parsed.data.officeLocations,
      })
      if (newLogoUploaded && nextLogoPath) {
        await organizationWorkspaceRepository.updateLogoPath(parsed.data.companyId, nextLogoPath)
      }
    } catch (error) {
      if (newLogoUploaded && nextLogoPath) await deleteMediaObject(nextLogoPath).catch(() => undefined)
      throw error
    }

    if (newLogoUploaded && nextLogoPath && workspace.logoPath && workspace.logoPath !== nextLogoPath) {
      await deleteMediaObject(workspace.logoPath).catch(() => undefined)
    }

    refreshOrganizationWorkspace(workspace.slug)
    return { success: true }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'capability_required') {
      return { error: 'Organization Pro branding access is required to edit this workspace.' }
    }
    return { error: 'We could not update the organization workspace. Your entered information is still here.' }
  }
}
