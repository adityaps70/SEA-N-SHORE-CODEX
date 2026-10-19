/**
 * Recruiter messaging exception (Oct 2026). A verified recruiter, or a hiring member of a verified organization,
 * may start a conversation with a member whose "Who can message me" is "connections only" when the member applied
 * to one of their jobs (about that application) or switched on "open to recruiters". A block and "Nobody" always
 * refuse, and each recruiter can start at most RECRUITER_CONVERSATIONS_PER_DAY such conversations in 24 hours.
 * The member's default stays "connections only".
 */
export const RECRUITER_CONTACT_REASONS = ['applied', 'open_to_recruiters'] as const
export type RecruiterContactReason = (typeof RECRUITER_CONTACT_REASONS)[number]

/** What the recruiter's button asks for: about one application, or because the member is open to recruiters. */
export type RecruiterContactRequest =
  | { reason: 'applied'; applicationId: string }
  | { reason: 'open_to_recruiters' }

export const RECRUITER_CONVERSATIONS_PER_DAY = 20
export const RECRUITER_CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000

/** The line shown above the recruiter's first message in a conversation started through the exception. */
export function recruiterContactLine(context: { reason: RecruiterContactReason; jobTitle: string | null }): string {
  if (context.reason === 'applied') {
    const title = context.jobTitle?.trim()
    return title ? `Sent because you applied to ${title}` : 'Sent because you applied to one of their jobs'
  }
  return 'Sent because you’re open to recruiters'
}
