'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireCapability } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import type { OrganizationAccessRole } from '@/features/access/policy'
import { createMediaUploadUrl, deleteMediaObject, headMediaObject } from '@/lib/aws/storage'
import { organizationWorkspaceRepository } from './workspace-repository'
import { WELLBEING_SERVICE_VALUES, isWellbeingType } from './organization-types'
import { COMPANY_SIZE_VALUES, MAX_SPECIALTIES, TAGLINE_MAX_LENGTH, type CompanySize } from './organization-page-profile'
import { plainFieldErrors } from '@/lib/validation/plain-messages'

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

const removeMemberSchema = z.object({
  companyId: uuidSchema,
  memberId: uuidSchema,
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

const supportSchema = z.object({
  servicesOffered: z.array(z.enum(WELLBEING_SERVICE_VALUES as [string, ...string[]], { message: 'Choose services from the list.' })).max(WELLBEING_SERVICE_VALUES.length),
  languages: z.preprocess(
    (value) => typeof value === 'string'
      ? [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))]
      : [],
    z.array(z.string().min(2, 'Enter each language using at least 2 characters.').max(60, 'Keep each language to 60 characters or fewer.')).max(20, 'Add no more than 20 languages.'),
  ),
  helpline24x7: z.preprocess(
    (value) => value === 'yes' ? true : value === 'no' ? false : null,
    z.boolean().nullable(),
  ),
})

const pageDetailsSchema = z.object({
  tagline: z.preprocess(
    (value) => typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ') : null,
    z.string().max(TAGLINE_MAX_LENGTH, `Keep the tagline to ${TAGLINE_MAX_LENGTH} characters or fewer.`).nullable(),
  ),
  companySize: z.preprocess(
    (value) => typeof value === 'string' && value ? value : null,
    z.enum(COMPANY_SIZE_VALUES as [CompanySize, ...CompanySize[]], { message: 'Choose a company size from the list.' }).nullable(),
  ),
  specialties: z.preprocess(
    (value) => typeof value === 'string'
      ? [...new Set(value.split(',').map((entry) => entry.trim().replace(/\s+/g, ' ')).filter(Boolean))]
      : [],
    z.array(
      z.string()
        .min(2, 'Enter each speciality using at least 2 characters.')
        .max(60, 'Keep each speciality to 60 characters or fewer.'),
    ).max(MAX_SPECIALTIES, `Add no more than ${MAX_SPECIALTIES} specialities.`),
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
  revalidatePath(`${workspacePath(slug)}/manage`)
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

/**
 * Removes a person from the organization's team. Only owners and administrators with team
 * management can do this; the repository re-checks the actor's role inside the transaction,
 * only owners can remove an owner, and the last owner can never be removed (including by
 * leaving themselves).
 */
export async function removeOrganizationMember(input: {
  companyId: string
  memberId: string
}): Promise<OrganizationWorkspaceActionResult & { left?: boolean }> {
  const parsed = removeMemberSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Choose a valid organization team member.' }

  try {
    const user = await requireAwsUser()
    await requireCapability(user.id, 'organization.team', { companyId: parsed.data.companyId })
    const workspace = await organizationWorkspaceRepository.getById(parsed.data.companyId)
    if (!workspace) return { ok: false, error: 'This organization workspace could not be found.' }

    await organizationWorkspaceRepository.removeMember(user.id, parsed.data.companyId, parsed.data.memberId)
    refreshOrganizationWorkspace(workspace.slug)
    return { ok: true, left: parsed.data.memberId === user.id }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'capability_required') {
      return { ok: false, error: 'Organization Pro team-management access is required to remove team members.' }
    }
    if (code === 'organization_member_remove_forbidden') {
      return { ok: false, error: 'Only the owner and administrators can remove team members, and only an owner can remove an owner.' }
    }
    if (code === 'organization_last_owner') {
      return { ok: false, error: 'The organization needs at least one owner, so its last owner cannot be removed.' }
    }
    if (code === 'organization_member_not_found') {
      return { ok: false, error: 'This organization member could not be found.' }
    }
    return { ok: false, error: 'We could not remove this team member. Please try again.' }
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
      fieldErrors: plainFieldErrors(parsed.error),
    }
  }

  try {
    const user = await requireAwsUser()
    await requireCapability(user.id, 'organization.branding', { companyId: parsed.data.companyId })
    const workspace = await organizationWorkspaceRepository.getById(parsed.data.companyId)
    if (!workspace) return { error: 'This organization workspace could not be found.' }

    let supportDetails: { servicesOffered: string[]; languages: string[]; helpline24x7: boolean | null } | undefined
    if (isWellbeingType(workspace.organizationType)) {
      const support = supportSchema.safeParse({
        servicesOffered: formData.getAll('servicesOffered').map(String),
        languages: formData.get('languages'),
        helpline24x7: formData.get('helpline24x7'),
      })
      if (!support.success) {
        return {
          error: 'Please correct the highlighted organization information.',
          fieldErrors: plainFieldErrors(support.error),
        }
      }
      supportDetails = support.data
    }

    // Page details (tagline, size, specialities) are only changed when the form sends them.
    let pageDetails: { tagline: string | null; companySize: CompanySize | null; specialties: string[] } | undefined
    if (formData.has('tagline') || formData.has('companySize') || formData.has('specialties')) {
      const details = pageDetailsSchema.safeParse({
        tagline: formData.get('tagline'),
        companySize: formData.get('companySize'),
        specialties: formData.get('specialties'),
      })
      if (!details.success) {
        return {
          error: 'Please correct the highlighted organization information.',
          fieldErrors: plainFieldErrors(details.error),
        }
      }
      pageDetails = details.data
    }

    const removeCover = formData.get('removeCover') === 'on'

    try {
      await organizationWorkspaceRepository.updateBranding(parsed.data.companyId, {
        website: parsed.data.website,
        description: parsed.data.description,
        fleetSummary: parsed.data.fleetSummary,
        vesselTypes: parsed.data.vesselTypes,
        officeLocations: parsed.data.officeLocations,
        ...(pageDetails ?? {}),
        supportDetails,
      })
      if (removeCover && workspace.coverPath) {
        await organizationWorkspaceRepository.updateCoverPath(parsed.data.companyId, null)
        await deleteMediaObject(workspace.coverPath).catch(() => undefined)
      }
    } catch {
      return { error: 'We could not update the organization workspace. Your entered information is still here.' }
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

export type OrganizationMediaKind = 'logo' | 'cover'

/** Signed size-limited ticket, issued only after organization-branding capability checks. */
export async function requestOrganizationMediaUploadAction(input: {
  companyId: string
  kind: OrganizationMediaKind
  contentType: string
  size: number
}): Promise<{ success?: boolean; error?: string; key?: string; uploadUrl?: string }> {
  const parsed = uuidSchema.safeParse(input.companyId)
  if (!parsed.success || !['logo', 'cover'].includes(input.kind)) return { error: 'Invalid organization.' }
  if (!logoTypes[input.contentType] || !Number.isInteger(input.size) || input.size <= 0 || input.size > MAX_LOGO_BYTES) {
    return { error: 'Image must be a JPG, PNG or WebP file up to 5 MB.' }
  }
  try {
    const user = await requireAwsUser()
    await requireCapability(user.id, 'organization.branding', { companyId: parsed.data })
    const workspace = await organizationWorkspaceRepository.getById(parsed.data)
    if (!workspace) return { error: 'This organization workspace could not be found.' }
    const key = `organizations/${parsed.data}/${input.kind}-${randomUUID()}.${logoTypes[input.contentType]}`
    const uploadUrl = await createMediaUploadUrl({ key, contentType: input.contentType, contentLength: input.size })
    return { success: true, key, uploadUrl }
  } catch {
    return { error: 'Upload failed, try again.' }
  }
}

export async function completeOrganizationMediaUploadAction(input: {
  companyId: string
  kind: OrganizationMediaKind
  key: string
}): Promise<{ success?: boolean; error?: string }> {
  const parsed = uuidSchema.safeParse(input.companyId)
  if (!parsed.success || !['logo', 'cover'].includes(input.kind)) return { error: 'Invalid organization.' }
  const expectedPrefix = `organizations/${parsed.data}/${input.kind}-`
  if (!input.key.startsWith(expectedPrefix) || !/\.(jpg|png|webp)$/.test(input.key)) return { error: 'Upload failed, try again.' }
  try {
    const user = await requireAwsUser()
    await requireCapability(user.id, 'organization.branding', { companyId: parsed.data })
    const workspace = await organizationWorkspaceRepository.getById(parsed.data)
    if (!workspace) return { error: 'This organization workspace could not be found.' }
    const object = await headMediaObject(input.key)
    if (!object.contentType || !logoTypes[object.contentType] || !object.contentLength ||
        object.contentLength > MAX_LOGO_BYTES || !input.key.endsWith('.' + logoTypes[object.contentType])) {
      await deleteMediaObject(input.key).catch(() => undefined)
      return { error: 'Image must be a JPG, PNG or WebP file up to 5 MB.' }
    }
    try {
      if (input.kind === 'logo') await organizationWorkspaceRepository.updateLogoPath(parsed.data, input.key)
      else await organizationWorkspaceRepository.updateCoverPath(parsed.data, input.key)
    } catch {
      await deleteMediaObject(input.key).catch(() => undefined)
      throw new Error('organization_media_finalize_failed')
    }
    const oldPath = input.kind === 'logo' ? workspace.logoPath : workspace.coverPath
    if (oldPath && oldPath !== input.key) await deleteMediaObject(oldPath).catch(() => undefined)
    refreshOrganizationWorkspace(workspace.slug)
    return { success: true }
  } catch {
    return { error: 'Upload failed, try again.' }
  }
}
