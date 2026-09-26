/** Plain-language formatting for administrator audit events, shared by the overview and the audit log. */

function sentenceCase(value: string) {
  const text = value.replaceAll('_', ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

/** "account.permanently_deleted" → "Account · Permanently deleted" */
export function auditActionLabel(action: string) {
  return action.split('.').map(sentenceCase).filter(Boolean).join(' · ')
}

/** The verb part only: "account.permanently_deleted" → "Permanently deleted". */
export function auditVerb(action: string) {
  const parts = action.split('.').filter(Boolean)
  return sentenceCase((parts.length > 1 ? parts.slice(1) : parts).join(' '))
}

/** One readable phrase: ("user_account", "account.suspended") → "Account suspended". */
export function auditSummary(targetType: string, action: string) {
  return `${auditTargetLabel(targetType)} ${auditVerb(action).toLowerCase()}`
}

const TARGET_LABELS: Record<string, string> = {
  organization_application: 'Organization',
  user_account: 'Account',
  post: 'Post',
  comment: 'Comment',
  job: 'Job',
  event: 'Event',
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
  if (previousState) values.push(`Previously ${previousState.replaceAll('_', ' ')}`)
  if (reportCount !== null) values.push(`${reportCount} report${reportCount === 1 ? '' : 's'}`)
  if (note) values.push(note)
  return values
}
