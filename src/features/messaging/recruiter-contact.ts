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

/**
 * The line shown above the recruiter's first message in a conversation started through the exception, worded for
 * who reads it: the member ("you applied …") or the recruiter ("they applied …").
 */
export function recruiterContactLine(context: {
  reason: RecruiterContactReason
  jobTitle: string | null
  viewer: 'member' | 'recruiter'
}): string {
  const member = context.viewer === 'member'
  if (context.reason === 'applied') {
    const title = context.jobTitle?.trim()
    if (title) return `Sent because ${member ? 'you' : 'they'} applied to ${title}`
    return member ? 'Sent because you applied to one of their jobs' : 'Sent because they applied to one of your jobs'
  }
  return member ? 'Sent because you’re open to recruiters' : 'Sent because they’re open to recruiters'
}
