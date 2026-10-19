import { createNetworkRepository } from '@/features/network/repository'
import { createMessagingRepository } from './repository'
import { recruiterContactLine, type RecruiterContactRequest } from './recruiter-contact'
import { createRecruiterContactRepository } from './recruiter-contact-repository'

const recruiters = createRecruiterContactRepository()

/**
 * Recruiter messaging exception: the reason line for a conversation a recruiter started that way, or null. Call
 * only after the viewer's participation was checked (getConversationThread refuses non-participants).
 */
export async function getRecruiterContact(conversationId: string): Promise<{ recruiterProfileId: string; line: string } | null> {
  const row = await recruiters.findByConversation(conversationId)
  if (!row) return null
  return { recruiterProfileId: row.recruiter_profile_id, line: recruiterContactLine({ reason: row.reason, jobTitle: row.job_title }) }
}

/** A personal recruiter verification, or an approved hiring role in a verified organization. */
export async function isVerifiedRecruiter(profileId: string): Promise<boolean> {
  return recruiters.isVerifiedRecruiter(profileId)
}

/**
 * May this recruiter open a conversation with the member from a recruiter screen, and with which reason? Mirrors
 * startDirectConversation without writing: a block or "Nobody" refuses; a connection or "Everyone" allows; otherwise
 * a verified recruiter may write when the member applied to one of their jobs (`applicationId`) or is open to
 * recruiters. `contact` is passed to startDirectConversationAction so the reason line is recorded.
 */
export async function recruiterMessageAccess(input: {
  recruiterId: string
  memberId: string
  applicationId?: string
}, deps: {
  recruiters?: ReturnType<typeof createRecruiterContactRepository>
  network?: Pick<ReturnType<typeof createNetworkRepository>, 'isPairBlocked' | 'findConnectionByPair'>
  messaging?: Pick<ReturnType<typeof createMessagingRepository>, 'getMessagePermission'>
} = {}): Promise<{ canMessage: boolean; contact: RecruiterContactRequest | null }> {
  const repo = deps.recruiters ?? recruiters
  const network = deps.network ?? createNetworkRepository()
  const messaging = deps.messaging ?? createMessagingRepository()
  if (input.recruiterId === input.memberId) return { canMessage: false, contact: null }

  const [blocked, connection, permission] = await Promise.all([
    network.isPairBlocked(input.recruiterId, input.memberId),
    network.findConnectionByPair(input.recruiterId, input.memberId),
    messaging.getMessagePermission(input.memberId),
  ])
  if (blocked || permission === 'nobody') return { canMessage: false, contact: null }

  let contact: RecruiterContactRequest | null = null
  if (await repo.isVerifiedRecruiter(input.recruiterId)) {
    if (input.applicationId && await repo.findApplicationForRecruiter(input.recruiterId, input.memberId, input.applicationId)) {
      contact = { reason: 'applied', applicationId: input.applicationId }
    } else if (!input.applicationId && await repo.isOpenToRecruiters(input.memberId)) {
      contact = { reason: 'open_to_recruiters' }
    }
  }
  const normallyAllowed = permission === 'everyone' || connection?.status === 'accepted'
  return { canMessage: normallyAllowed || contact !== null, contact }
}
