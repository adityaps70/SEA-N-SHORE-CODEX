import { z } from 'zod'

/**
 * Company training crew (round D, part 3): who a company may give seats to. Only Sea N Shore members who accepted the
 * company's invitation. Accepting is the member's consent to share, for the courses the company assigns them, their
 * progress and the certificate for that course, and nothing else. Safe to import from client components.
 */

export const CONSENT_VERSION = 'company-training-v1'
export const INVITATION_DAYS = 30
export const INVITE_BATCH_MAX = 50
export const INVITES_PER_DAY = 300

export function consentWording(companyName: string) {
  return {
    shares: [
      `The courses ${companyName} assigns you with a seat`,
      'Your progress and completion in those courses',
      'The certificate for each of those courses (number, issue date and expiry)',
    ],
    neverShares: [
      'Your other courses, purchases and certificates',
      'Your quiz answers, messages, posts and the rest of your profile',
    ],
    summary: `${companyName} will see your progress and certificates for the courses it assigns you, and nothing else. You can stop sharing at any time from My Learning.`,
  }
}

const tag = z.string().trim().max(80).transform((value) => value.replace(/\s+/g, ' ')).transform((value) => value || null)

export const crewTagsSchema = z.object({ vessel: tag.nullable().optional(), rank: tag.nullable().optional() })

/** Splits pasted text into unique, lower-case email addresses; anything that is not an address is returned apart. */
export function parseInviteEmails(text: string) {
  const valid: string[] = []
  const invalid: string[] = []
  for (const raw of text.split(/[\s,;]+/)) {
    const email = raw.trim().replace(/^<|>$/g, '').toLowerCase()
    if (!email) continue
    if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (!valid.includes(email)) valid.push(email)
    } else if (!invalid.includes(email)) invalid.push(email)
  }
  return { valid, invalid }
}

export type CrewRefusal =
  | 'invite_none'
  | 'invite_too_many'
  | 'invite_daily_limit'
  | 'invitation_not_found'
  | 'invitation_other_email'
  | 'invitation_closed'
  | 'crew_member_not_found'

export class CrewError extends Error {
  constructor(readonly code: CrewRefusal) {
    super(code)
    this.name = 'CrewError'
  }
}

export function crewRefusalMessage(code: CrewRefusal) {
  switch (code) {
    case 'invite_none':
      return 'Enter at least one email address.'
    case 'invite_too_many':
      return `Invite up to ${INVITE_BATCH_MAX} people at a time.`
    case 'invite_daily_limit':
      return `This organization has sent ${INVITES_PER_DAY} invitations in the last 24 hours. Try again tomorrow.`
    case 'invitation_not_found':
      return 'We could not find this invitation. It may have been cancelled.'
    case 'invitation_other_email':
      return 'This invitation was sent to a different email address. Sign in with the account for that address to answer it.'
    case 'invitation_closed':
      return 'This invitation is no longer open. Ask the organization to invite you again.'
    case 'crew_member_not_found':
      return 'We could not find this crew member. Refresh the page and try again.'
  }
}
