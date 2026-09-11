'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { organizationRepository, type OrganizationApplicationInput } from './repository'
import { organizationApplicationSchema } from './schemas'

type OrganizationActionResult = { ok: true } | { ok: false; error: string }
type OrganizationSubmitResult = { ok: true; applicationId: string } | { ok: false; error: string }

const applicationIdSchema = z.string().uuid()

function validationError(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Please check the organization information and try again.'
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
  return 'We could not save the organization application. Please try again.'
}

function refreshOrganizationHiring() {
  revalidatePath('/hiring')
  revalidatePath('/hiring/organization')
}

export async function submitOrganizationApplication(input: OrganizationApplicationInput): Promise<OrganizationSubmitResult> {
  const parsed = organizationApplicationSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }

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
  if (!parsedId.success) return { ok: false, error: 'Invalid organization application.' }
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }

  try {
    const user = await requireAwsUser()
    await organizationRepository.resubmitOrganizationApplication(user.id, parsedId.data, parsed.data)
    refreshOrganizationHiring()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}
