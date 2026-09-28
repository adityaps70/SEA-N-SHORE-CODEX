'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import type { LinkedOrganization } from '@/features/profiles/organization-link'
import { organizationApplicationSchema } from './schemas'
import type { OrganizationApplicationInput } from './types'
import { unclaimedOrganizationSchema, UNCLAIMED_ORGANIZATIONS_PER_DAY, type UnclaimedOrganizationInput } from './unclaimed-organization-policy'
import { UnclaimedOrganizationError, unclaimedOrganizationRepository } from './unclaimed-organization-repository'

export type CreateUnclaimedOrganizationResult =
  | { ok: true; organization: LinkedOrganization }
  | {
      ok: false
      error: string
      fieldErrors?: Record<string, string[]>
      /** The organization that already has this name, to choose instead. */
      existing?: LinkedOrganization
    }

export type SubmitOrganizationClaimResult =
  | { ok: true; applicationId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

const companyIdSchema = z.string().uuid()

function signedOut(error: unknown) {
  return error instanceof Error && /authentication required/i.test(error.message)
}

function createErrorMessage(error: UnclaimedOrganizationError): string {
  switch (error.code) {
    case 'organization_duplicate_name':
      return `${error.existing?.name ?? 'An organization with this name'} is already on Sea N Shore. Choose it instead of adding it again.`
    case 'organization_duplicate_in_review':
      return 'An organization with this name is already waiting for Sea N Shore review. Type the name without choosing from the list for now.'
    case 'unclaimed_organization_rate_limited':
      return `You can add up to ${UNCLAIMED_ORGANIZATIONS_PER_DAY} organizations a day. Try again tomorrow, or type the name without choosing from the list.`
    default:
      return 'We could not add this organization. Check your connection and try again.'
  }
}

/**
 * "I just work there": adds an unclaimed organization page so the member can
 * link it as their current organization. Nobody manages the page until someone
 * who owns or manages the organization claims it.
 */
export async function createUnclaimedOrganization(input: UnclaimedOrganizationInput): Promise<CreateUnclaimedOrganizationResult> {
  const parsed = unclaimedOrganizationSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted information and try again.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  try {
    const user = await requireAwsUser()
    const organization = await unclaimedOrganizationRepository.createUnclaimedOrganization(user.id, parsed.data)
    revalidatePath('/organizations')
    return { ok: true, organization }
  } catch (error) {
    if (error instanceof UnclaimedOrganizationError) {
      return {
        ok: false,
        error: createErrorMessage(error),
        ...(error.code === 'organization_duplicate_name' ? { fieldErrors: { name: [createErrorMessage(error)] } } : {}),
        ...(error.existing ? { existing: error.existing } : {}),
      }
    }
    if (signedOut(error)) return { ok: false, error: 'Your session may have expired. Sign in again and add the organization again.' }
    return { ok: false, error: 'We could not add this organization. Check your connection and try again.' }
  }
}

function claimErrorMessage(error: UnclaimedOrganizationError): string {
  switch (error.code) {
    case 'organization_not_found':
      return 'We could not find this organization page. It may have been removed.'
    case 'organization_already_claimed':
      return 'This organization page has already been claimed. Ask its owner or administrators for access instead.'
    case 'organization_claim_in_review':
      return 'Someone has already asked to claim this page and Sea N Shore is reviewing it. You can ask for access once the review is finished.'
    case 'organization_claim_own_review':
      return 'Your claim for this page is already with Sea N Shore. Follow it from your Organizations page.'
    case 'organization_application_in_progress':
      return 'You already have an organization waiting for Sea N Shore review. You can claim another page once that review is finished.'
    case 'organization_duplicate_name':
      return `${error.existing?.name ?? 'Another organization'} already uses this name. Keep the page's current name or choose a different one.`
    case 'organization_duplicate_in_review':
      return 'Another organization with this name is waiting for Sea N Shore review. Keep the page’s current name.'
    default:
      return 'We could not send this claim right now. Please try again.'
  }
}

/**
 * "Claim this page": goes through the same Sea N Shore verification review as
 * registering a new organization. The claimant's workspace opens once approved.
 */
export async function submitOrganizationClaim(companyId: string, input: OrganizationApplicationInput): Promise<SubmitOrganizationClaimResult> {
  const parsedId = companyIdSchema.safeParse(companyId)
  if (!parsedId.success) return { ok: false, error: 'This claim link is invalid. Open the organization page and choose Claim this page again.' }
  const parsed = organizationApplicationSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted information and try again.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  try {
    const user = await requireAwsUser()
    const result = await unclaimedOrganizationRepository.submitClaim(user.id, parsedId.data, parsed.data)
    revalidatePath('/organizations')
    revalidatePath(`/organizations/${result.slug}`)
    revalidatePath('/hiring/organization')
    return { ok: true, applicationId: result.applicationId }
  } catch (error) {
    if (error instanceof UnclaimedOrganizationError) {
      const message = claimErrorMessage(error)
      return {
        ok: false,
        error: message,
        ...(error.code === 'organization_duplicate_name' || error.code === 'organization_duplicate_in_review'
          ? { fieldErrors: { organizationName: [message] } }
          : {}),
      }
    }
    if (signedOut(error)) return { ok: false, error: 'Your session may have expired. Sign in again and send the claim again; your entries are still here.' }
    return { ok: false, error: 'We could not send this claim. Check your connection and try again; your entries are still here.' }
  }
}
