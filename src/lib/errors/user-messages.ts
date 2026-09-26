/**
 * Maps internal error codes (thrown as `new Error('some_code')` by repositories
 * and services) to plain, user-facing sentences. Use it wherever a server action
 * or route returns `{ ok: false, error }`, so people never see raw codes such as
 * `organization_access_request_exists`.
 *
 *   return { ok: false, error: userFacingError(error, 'We could not save your post. Try again.') }
 */

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Sign in again, then retry.'
export const GENERIC_RETRY_MESSAGE = 'Something went wrong on our side and nothing was changed. Please try again in a moment.'

/** Exact codes with a specific message. Keep sentences short: what happened, then what to do. */
export const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  // Session & access
  auth_required: SESSION_EXPIRED_MESSAGE,
  unauthenticated: SESSION_EXPIRED_MESSAGE,
  admin_forbidden: 'This page is only available to Sea N Shore administrators.',
  hiring_forbidden: 'You do not have hiring access for this organization. Ask an organization administrator to give you a recruiter role.',
  event_forbidden: 'You do not have permission to manage this event.',
  course_forbidden: 'You do not have permission to manage this course.',
  course_edit_forbidden: 'You do not have permission to edit this course.',
  network_action_not_allowed: 'This connection action is not available for this member right now.',

  // Organizations
  organization_access_request_exists: 'You already have a request waiting for this organization. You will be notified when an administrator reviews it.',
  organization_membership_exists: 'You are already a member of this organization.',
  organization_not_found: 'This organization could not be found. It may have been removed or renamed.',
  organization_owner_role_locked: 'The organization owner role cannot be changed here.',
  company_access_request_not_found: 'This access request no longer exists. It may already have been reviewed.',
  legacy_company_already_exists: 'An organization with this name already exists. Search for it and request to join instead.',

  // Content, jobs, events, learning
  feed_repost_duplicate: 'You have already reposted this post.',
  event_full: 'This event is full.',
  event_not_open: 'Registration for this event is not open.',
  event_host_cannot_attend: 'Hosts cannot register for their own event.',
  course_not_enrollable: 'This course is not open for enrollment.',
  learning_attempt_limit_reached: 'You have used all attempts for this activity.',
  enrollment_revoked: 'Your access to this course has been removed. Contact the course provider if you think this is a mistake.',
  username_change_limit: 'You have already changed your username the maximum number of times.',
  mentor_application_already_exists: 'You already have a mentor application. Check its status in My Activities.',
  verification_application_pending: 'You already have a verification application under review.',
  verification_already_approved: 'This verification is already approved.',
  moderation_self_report_forbidden: 'You cannot report your own content.',

  // Uploads
  media_object_too_large: 'That file is too large. Choose a smaller file and try again.',
  scorm_zip_too_large: 'That package is too large. Upload a smaller SCORM zip.',
  profile_media_type_unsupported: 'That image type is not supported. Use a JPG, PNG or WebP image.',

  // Newsletter
  newsletter_rate_limited: 'Too many sign-up attempts from this connection. Please wait a few minutes and try again.',
  newsletter_sending_disabled: 'Newsletter sending is turned off until Amazon SES production access is configured.',
}

const CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/

/** True when a string looks like an internal code (snake_case) rather than a sentence. */
export function isInternalErrorCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_PATTERN.test(value.trim())
}

/** Family-level fallbacks for codes that have no exact entry. */
function messageForCodeFamily(code: string): string | null {
  if (code.endsWith('_forbidden') || code.endsWith('_not_allowed') || code.endsWith('_required_role')) {
    return 'You do not have permission to do this. If you think you should, ask an administrator for access.'
  }
  if (code.endsWith('_not_found') || code.endsWith('_unavailable') || code.endsWith('_not_accessible')) {
    return 'This item could not be found. It may have been removed, or the link may be out of date.'
  }
  if (code.endsWith('_exists') || code.includes('_already_') || code.endsWith('_duplicate')) {
    return 'This has already been done, so nothing was changed.'
  }
  if (code.endsWith('_invalid') || code.endsWith('_mismatch') || code.includes('_policy_')) {
    return 'Some of the information could not be accepted. Check the form and try again.'
  }
  if (code.endsWith('_limit') || code.endsWith('_limit_reached') || code.endsWith('_rate_limited')) {
    return 'You have reached the limit for this action. Please try again later.'
  }
  if (code.endsWith('_failed')) return GENERIC_RETRY_MESSAGE
  return null
}

export function messageForErrorCode(code: string, fallback = GENERIC_RETRY_MESSAGE) {
  const normalized = code.trim()
  return KNOWN_ERROR_MESSAGES[normalized] ?? messageForCodeFamily(normalized) ?? fallback
}

function isSessionError(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.name === 'AwsAuthenticationRequiredError' || error.message === 'Authentication required.'
}

/**
 * Turns anything thrown or returned by server code into a sentence that is safe
 * to show. Internal codes are mapped; any other thrown message (database,
 * network, SDK text that may leak details) becomes `fallback`. For strings that
 * are already user-facing, use `displayableError`.
 */
export function userFacingError(error: unknown, fallback = GENERIC_RETRY_MESSAGE): string {
  if (isSessionError(error)) return SESSION_EXPIRED_MESSAGE
  const raw = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
  if (!raw) return fallback
  if (isInternalErrorCode(raw)) return messageForErrorCode(raw, fallback)
  return fallback
}

/**
 * For values that are already meant to be user-facing (e.g. `result.error` from
 * an action) but might still contain a raw code from older code paths.
 */
export function displayableError(message: string | null | undefined, fallback = GENERIC_RETRY_MESSAGE) {
  if (!message?.trim()) return fallback
  return isInternalErrorCode(message) ? messageForErrorCode(message, fallback) : message
}
