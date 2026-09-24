'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { organizationRepository, type OrganizationApplicationInput } from './repository'
import { organizationApplicationSchema } from './schemas'

type OrganizationFailure = {
  ok: false
  error: string
  fieldErrors?: Record<string, string[]>
}

type OrganizationActionResult = { ok: true } | OrganizationFailure
type OrganizationSubmitResult = { ok: true; applicationId: string } | OrganizationFailure

const applicationIdSchema = z.string().uuid()

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
