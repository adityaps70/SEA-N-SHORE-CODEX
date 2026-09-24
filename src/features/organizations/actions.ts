'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { organizationRepository, type OrganizationApplicationInput } from './repository'
import { COMPANY_ACCESS_REQUEST_ROLES, type CompanyAccessRequestRole, type CompanySearchResult } from './types'
import { organizationApplicationSchema } from './schemas'

type OrganizationFailure = {
  ok: false
  error: string
  fieldErrors?: Record<string, string[]>
}

type OrganizationActionResult = { ok: true } | OrganizationFailure
type OrganizationSubmitResult = { ok: true; applicationId: string } | OrganizationFailure
type OrganizationSearchResult =
  | { ok: true; organizations: CompanySearchResult[] }
  | { ok: false; error: string }
type OrganizationAccessRequestResult =
  | { ok: true; requestId: string }
  | { ok: false; error: string }

const applicationIdSchema = z.string().uuid()
const companyIdSchema = z.string().uuid()
const organizationSearchSchema = z.string().trim().min(2, 'Enter at least 2 characters to search organizations.').max(160)
const organizationAccessRequestSchema = z.object({
  companyId: companyIdSchema,
  requestedRole: z.enum(COMPANY_ACCESS_REQUEST_ROLES),
  message: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return null
      const normalized = value.trim()
      return normalized || null
    },
    z.string().max(2000, 'Keep the access request message to 2,000 characters or fewer.').nullable(),
  ),
})

function validationFailure(error: z.ZodError): OrganizationFailure {
  return {
    ok: false,
    error: 'Please correct the highlighted information and try again.',
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  }
}

function mutationError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'organization_resubmit_forbidden') {
      return 'This organization application cannot be resubmitted in its current state.'
    }
    if (error.message === 'organization_application_not_found') {
      return 'We could not find this organization application.'
    }
  }
  if (error instanceof Error && /authentication required/i.test(error.message)) {
    return 'Your session may have expired. Sign in again, return to organization verification, and submit this step again.'
  }
  return 'We could not save the organization application. Check your connection and try again; your entered information is still here.'
}

function refreshOrganizationHiring() {
  revalidatePath('/hiring')
  revalidatePath('/hiring/organization')
}

export async function searchOrganizations(term: string): Promise<OrganizationSearchResult> {
  const parsed = organizationSearchSchema.safeParse(term)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter an organization name to search.' }
  }

  try {
    await requireAwsUser()
    return { ok: true, organizations: await organizationRepository.searchCompanies(parsed.data) }
  } catch {
    return { ok: false, error: 'We could not search organizations. Check your connection and try again.' }
  }
}

export async function requestOrganizationAccess(
  companyId: string,
  requestedRole: CompanyAccessRequestRole,
  message: string | null,
): Promise<OrganizationAccessRequestResult> {
  const parsed = organizationAccessRequestSchema.safeParse({ companyId, requestedRole, message })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the organization access request and try again.' }
  }

  try {
    const user = await requireAwsUser()
    const result = await organizationRepository.requestCompanyAccess(
      user.id,
      parsed.data.companyId,
      parsed.data.requestedRole,
      parsed.data.message,
    )
    refreshOrganizationHiring()
    return { ok: true, requestId: result.requestId }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'organization_access_request_exists') {
      return { ok: false, error: 'You already have a pending access request for this organization and role.' }
    }
    if (code === 'organization_membership_exists') {
      return { ok: false, error: 'You already belong to this organization.' }
    }
    if (code === 'organization_company_not_found') {
      return { ok: false, error: 'This organization could not be found. Search again and choose an existing organization.' }
    }
    if (/authentication required/i.test(code)) {
      return { ok: false, error: 'Your session may have expired. Sign in again and retry the organization access request.' }
    }
    return { ok: false, error: 'We could not submit the organization access request. Please try again.' }
  }
}

export async function submitOrganizationApplication(input: OrganizationApplicationInput): Promise<OrganizationSubmitResult> {
  const parsed = organizationApplicationSchema.safeParse(input)
  if (!parsed.success) return validationFailure(parsed.error)

  try {
    const user = await requireAwsUser()
    const result = await organizationRepository.submitOrganizationApplication(user.id, parsed.data)
    refreshOrganizationHiring()
    return { ok: true, applicationId: result.applicationId }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

export async function resubmitOrganizationApplication(
  applicationId: string,
  input: OrganizationApplicationInput,
): Promise<OrganizationActionResult> {
  const parsedId = applicationIdSchema.safeParse(applicationId)
  const parsed = organizationApplicationSchema.safeParse(input)
  if (!parsedId.success) return { ok: false, error: 'This application link is invalid. Return to Organization verification and open the current application again.' }
  if (!parsed.success) return validationFailure(parsed.error)

  try {
    const user = await requireAwsUser()
    await organizationRepository.resubmitOrganizationApplication(user.id, parsedId.data, parsed.data)
    refreshOrganizationHiring()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}
