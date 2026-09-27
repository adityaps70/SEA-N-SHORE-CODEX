'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireCapability } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import type { OrganizationAccessRole } from '@/features/access/policy'
import { deleteMediaObject, putMediaObject } from '@/lib/aws/storage'
import { organizationWorkspaceRepository } from './workspace-repository'
import { WELLBEING_SERVICE_VALUES, isWellbeingType } from './organization-types'
import { COMPANY_SIZE_VALUES, MAX_SPECIALTIES, TAGLINE_MAX_LENGTH, type CompanySize } from './organization-page-profile'

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
const MAX_COVER_BYTES = 5 * 1024 * 1024

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
          fieldErrors: support.error.flatten().fieldErrors as Record<string, string[]>,
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
          fieldErrors: details.error.flatten().fieldErrors as Record<string, string[]>,
        }
      }
      pageDetails = details.data
    }

    const logo = formData.get('logo')
    const cover = formData.get('cover')
    const removeCover = formData.get('removeCover') === 'on'
    const hasNewLogo = logo instanceof File && logo.size > 0
    const hasNewCover = cover instanceof File && cover.size > 0

    if (hasNewLogo && (!logoTypes[logo.type] || logo.size > MAX_LOGO_BYTES)) {
      return { error: 'Organization logo must be a JPG, PNG or WebP image up to 5 MB.' }
    }
    if (hasNewCover && (!logoTypes[cover.type] || cover.size > MAX_COVER_BYTES)) {
      return { error: 'Cover image must be a JPG, PNG or WebP image up to 5 MB.' }
    }

    const uploaded: string[] = []
    let nextLogoPath: string | null = null
    let nextCoverPath: string | null = null

    try {
      if (hasNewLogo) {
        nextLogoPath = `organizations/${parsed.data.companyId}/logo-${randomUUID()}.${logoTypes[logo.type]}`
        await putMediaObject({
          key: nextLogoPath,
          body: new Uint8Array(await logo.arrayBuffer()),
          contentType: logo.type,
        })
        uploaded.push(nextLogoPath)
      }
      if (hasNewCover) {
        nextCoverPath = `organizations/${parsed.data.companyId}/cover-${randomUUID()}.${logoTypes[cover.type]}`
        await putMediaObject({
          key: nextCoverPath,
          body: new Uint8Array(await cover.arrayBuffer()),
          contentType: cover.type,
        })
        uploaded.push(nextCoverPath)
      }

      await organizationWorkspaceRepository.updateBranding(parsed.data.companyId, {
        website: parsed.data.website,
        description: parsed.data.description,
        fleetSummary: parsed.data.fleetSummary,
        vesselTypes: parsed.data.vesselTypes,
        officeLocations: parsed.data.officeLocations,
        ...(pageDetails ?? {}),
        supportDetails,
      })
      if (nextLogoPath) {
        await organizationWorkspaceRepository.updateLogoPath(parsed.data.companyId, nextLogoPath)
      }
      if (nextCoverPath || (removeCover && workspace.coverPath)) {
        await organizationWorkspaceRepository.updateCoverPath(parsed.data.companyId, nextCoverPath)
      }
    } catch (error) {
      await Promise.all(uploaded.map((key) => deleteMediaObject(key).catch(() => undefined)))
      throw error
    }

    if (nextLogoPath && workspace.logoPath && workspace.logoPath !== nextLogoPath) {
      await deleteMediaObject(workspace.logoPath).catch(() => undefined)
    }
    if ((nextCoverPath || removeCover) && workspace.coverPath && workspace.coverPath !== nextCoverPath) {
      await deleteMediaObject(workspace.coverPath).catch(() => undefined)
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
