import { countryName } from '@/features/countries/catalog'

/** Plain-language formatting for administrator audit events, shared by the overview and the audit log. */

function sentenceCase(value: string) {
  const text = value.replaceAll('_', ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

/** "account.permanently_deleted" → "Account · Permanently deleted" */
export function auditActionLabel(action: string) {
  return action.split('.').map(sentenceCase).filter(Boolean).join(' · ')
}

/**
 * The verb part only: "account.permanently_deleted" → "Permanently deleted". Round H (H7): a three-part action
 * names its object in the middle ("learning.course.revision_approved"); the target label already says that, so the
 * verb is the last part ("Revision approved").
 */
export function auditVerb(action: string) {
  const parts = action.split('.').filter(Boolean)
  return sentenceCase((parts.length > 2 ? parts.slice(2) : parts.length > 1 ? parts.slice(1) : parts).join(' '))
}

/**
 * One readable phrase: ("user_account", "account.suspended") → "Account suspended". Round H (H7): words the verb
 * repeats from the end of the target label are dropped ("Course" + "course community linked" → "Course community linked").
 */
export function auditSummary(targetType: string, action: string) {
  const label = auditTargetLabel(targetType)
  const labelWords = label.toLowerCase().split(/\s+/).filter(Boolean)
  const verbWords = auditVerb(action).toLowerCase().split(/\s+/).filter(Boolean)
  let overlap = Math.min(labelWords.length, verbWords.length)
  while (overlap > 0 && labelWords.slice(-overlap).join(' ') !== verbWords.slice(0, overlap).join(' ')) overlap -= 1
  return [label, ...verbWords.slice(overlap)].join(' ')
}

const TARGET_LABELS: Record<string, string> = {
  organization_application: 'Organization',
  user_account: 'Account',
  company_access_request: 'Access request',
  post: 'Post',
  comment: 'Comment',
  job: 'Job',
  event: 'Event',
  group: 'Group',
  course_review: 'Course review',
  // Round H (H7): learning, support and site settings audit targets.
  learning_course: 'Course',
  learning_mentor_application: 'Trainer application',
  support_ticket: 'Support request',
  site_setting: 'Site setting',
  // Round I (I2): Admin › Communities › Categories.
  community_category: 'Community category',
}

export function auditTargetLabel(targetType: string) {
  return TARGET_LABELS[targetType] ?? sentenceCase(targetType)
}

export function auditTargetHref(targetType: string, targetId: string) {
  if (targetType === 'post') return `/posts/${targetId}`
  if (targetType === 'job') return `/jobs/${targetId}`
  if (targetType === 'event') return `/events/${targetId}`
  if (targetType === 'organization_application') return `/admin/organizations/${targetId}`
  if (targetType === 'user_account') return `/admin/users/${targetId}`
  if (targetType === 'group') return `/admin/communities?group=${targetId}`
  if (targetType === 'support_ticket') return `/admin/support/${targetId}`
  if (targetType === 'site_setting') return '/admin/settings'
  if (targetType === 'community_category') return '/admin/communities/categories'
  return null
}

export function auditDetails(metadata: Record<string, unknown>) {
  const values: string[] = []
  const text = (key: string) => (typeof metadata[key] === 'string' ? (metadata[key] as string).trim() : '')
  const note = text('note') || text('reviewerNote') || text('reason')
  const decision = text('decision')
  const previousState = text('previousState')
  const rawCount = metadata.reportCount
  const reportCount = typeof rawCount === 'number'
    ? rawCount
    : typeof rawCount === 'string' && /^\d+$/.test(rawCount)
      ? Number(rawCount)
      : null

  if (decision) values.push(`Decision: ${decision.replaceAll('_', ' ')}`)
  // Round GP (Part C): the organization's country, and whether a country admin decided.
  if (text('actorRole') === 'country_admin') values.push('By a country admin')
  const country = text('country')
  if (/^[A-Z]{2}$/.test(country)) values.push(`Country: ${countryName(country) ?? country}`)
  const countries = Array.isArray(metadata.countries) ? metadata.countries.filter((code): code is string => typeof code === 'string') : []
  if (countries.length) values.push(`Countries: ${countries.map((code) => countryName(code) ?? code).join(', ')}`)
  if (previousState) values.push(`Previously ${previousState.replaceAll('_', ' ')}`)
  if (reportCount !== null) values.push(`${reportCount} report${reportCount === 1 ? '' : 's'}`)
  if (note) values.push(note)
  return values
}
