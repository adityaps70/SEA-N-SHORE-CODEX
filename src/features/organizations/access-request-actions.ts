'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { organizationAccessRequestRepository } from './access-request-repository'
import { organizationWorkspaceRepository } from './workspace-repository'
import { COMPANY_ACCESS_REQUEST_ROLES, type CompanyAccessRequestRole } from './types'
import { accessRequestErrorMessage } from './access-request-messages'

export type AccessRequestActionResult = { ok: true } | { ok: false; error: string }

const optionalNote = (maximum: number, message: string) => z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized || null
  },
  z.string().max(maximum, message).nullable(),
)

const decisionSchema = z.object({
  requestId: z.string().uuid('This request link is invalid. Reload the page and try again.'),
  decision: z.enum(['approved', 'rejected']),
  grantedRole: z.enum(COMPANY_ACCESS_REQUEST_ROLES).nullable(),
  note: optionalNote(4000, 'Keep the note to 4,000 characters or fewer.'),
})

const escalationSchema = z.object({
  requestId: z.string().uuid('This request link is invalid. Reload the page and try again.'),
  note: z.string().trim()
    .min(10, 'Tell Sea N Shore in a sentence or two why you are asking for help (at least 10 characters).')
    .max(2000, 'Keep the message to 2,000 characters or fewer.'),
})

const requestIdSchema = z.string().uuid()

async function refreshForCompany(companyId: string) {
  revalidatePath('/organizations')
  revalidatePath('/admin/access')
  try {
    const workspace = await organizationWorkspaceRepository.getById(companyId)
    if (workspace) revalidatePath(`/organizations/${workspace.slug}`)
  } catch {
    // The decision is already saved; a stale page refreshes on next navigation.
  }
}

export async function decideOrganizationAccessRequest(input: {
  requestId: string
  decision: 'approved' | 'rejected'
  grantedRole?: CompanyAccessRequestRole | null
  note?: string | null
}): Promise<AccessRequestActionResult> {
  const parsed = decisionSchema.safeParse({
    requestId: input.requestId,
    decision: input.decision,
    grantedRole: input.grantedRole ?? null,
    note: input.note ?? null,
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the decision and try again.' }
  if (parsed.data.decision === 'approved' && !parsed.data.grantedRole) {
    return { ok: false, error: 'Choose the role to grant before approving.' }
  }

  try {
    const user = await requireAwsUser()
    const result = await organizationAccessRequestRepository.decide(user.id, {
      requestId: parsed.data.requestId,
      decision: parsed.data.decision,
      grantedRole: parsed.data.decision === 'approved' ? parsed.data.grantedRole : null,
      note: parsed.data.note,
    })
    await refreshForCompany(result.companyId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: accessRequestErrorMessage(error instanceof Error ? error.message : '') }
  }
}

export async function escalateOrganizationAccessRequest(requestId: string, note: string): Promise<AccessRequestActionResult> {
  const parsed = escalationSchema.safeParse({ requestId, note })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the message and try again.' }

  try {
    const user = await requireAwsUser()
    const result = await organizationAccessRequestRepository.escalate(user.id, parsed.data.requestId, parsed.data.note)
    await refreshForCompany(result.companyId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: accessRequestErrorMessage(error instanceof Error ? error.message : '') }
  }
}

export async function withdrawOrganizationAccessRequest(requestId: string): Promise<AccessRequestActionResult> {
  if (!requestIdSchema.safeParse(requestId).success) {
    return { ok: false, error: 'This request link is invalid. Reload the page and try again.' }
  }
  try {
    const user = await requireAwsUser()
    const result = await organizationAccessRequestRepository.withdraw(user.id, requestId)
    await refreshForCompany(result.companyId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: accessRequestErrorMessage(error instanceof Error ? error.message : '') }
  }
}
