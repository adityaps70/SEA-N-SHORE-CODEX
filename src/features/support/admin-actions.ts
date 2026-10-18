'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { firstPlainIssue } from '@/lib/validation/plain-messages'
import { supportRepository } from './repository'
import { ticketReplySchema } from './topics'

/**
 * Round H (H7): Admin › Support. Platform administrators with admin MFA answer, close and reopen
 * Contact page tickets. An answer marks the ticket answered and queues the email to the sender (sent
 * by the outbox worker). Each change is audited in the repository.
 */
export type AdminTicketState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldError?: string
  body?: string
}

const NOT_ALLOWED = 'Only platform administrators with an authenticator app can answer support requests.'

async function requireSupportAdmin() {
  return requirePlatformAdministratorUser()
}

function refresh(ticketId: string) {
  revalidatePath('/admin/support')
  revalidatePath(`/admin/support/${ticketId}`)
  revalidatePath('/help/requests')
  revalidatePath(`/help/requests/${ticketId}`)
}

function errorCode(error: unknown) {
  return (error as { code?: string } | null)?.code ?? (error instanceof Error ? error.name : 'unknown')
}

export async function replyToTicketAsAdmin(ticketId: string, _previous: AdminTicketState, formData: FormData): Promise<AdminTicketState> {
  const body = String(formData.get('body') ?? '')
  let adminId: string
  try {
    adminId = (await requireSupportAdmin()).id
  } catch {
    return { status: 'error', message: NOT_ALLOWED, body }
  }
  const parsed = ticketReplySchema.safeParse({ body })
  if (!parsed.success) return { status: 'error', fieldError: firstPlainIssue(parsed.error, 'Write your reply.'), body }
  try {
    const result = await supportRepository.replyAsAdmin(adminId, ticketId, parsed.data.body)
    if (!result.ok) {
      return {
        status: 'error',
        message: result.reason === 'closed' ? 'This request is closed. Reopen it to reply.' : 'This request could not be found.',
        body,
      }
    }
    refresh(ticketId)
    return { status: 'success', message: 'Reply sent. The sender gets it by email, and the request is marked answered.' }
  } catch (error) {
    console.error('[support_admin_reply_failed]', { code: errorCode(error) })
    return { status: 'error', message: 'The reply could not be sent. Please try again.', body }
  }
}

export type AdminTicketStatusResult = { ok: true } | { ok: false; error: string }

async function changeStatus(ticketId: string, next: 'closed' | 'open'): Promise<AdminTicketStatusResult> {
  let adminId: string
  try {
    adminId = (await requireSupportAdmin()).id
  } catch {
    return { ok: false, error: NOT_ALLOWED }
  }
  try {
    const result = await supportRepository.setStatusAsAdmin(adminId, ticketId, next)
    if (!result.ok) {
      return { ok: false, error: result.reason === 'unchanged' ? 'This request was already changed. Refresh the page.' : 'This request could not be found.' }
    }
    refresh(ticketId)
    return { ok: true }
  } catch (error) {
    console.error('[support_admin_status_failed]', { code: errorCode(error) })
    return { ok: false, error: 'The request could not be updated. Please try again.' }
  }
}

export async function closeTicketAsAdmin(ticketId: string): Promise<AdminTicketStatusResult> {
  return changeStatus(ticketId, 'closed')
}

export async function reopenTicketAsAdmin(ticketId: string): Promise<AdminTicketStatusResult> {
  return changeStatus(ticketId, 'open')
}
