import { describe, expect, it } from 'vitest'
import {
  displayableError,
  GENERIC_RETRY_MESSAGE,
  isInternalErrorCode,
  messageForErrorCode,
  SESSION_EXPIRED_MESSAGE,
  userFacingError,
} from './user-messages'

describe('user-facing error messages', () => {
  it('maps known server codes to plain sentences', () => {
    expect(messageForErrorCode('organization_access_request_exists')).toBe(
      'You already have a request waiting for this organization. You will be notified when an administrator reviews it.',
    )
    expect(messageForErrorCode('event_full')).toBe('This event is full.')
    expect(userFacingError(new Error('feed_repost_duplicate'))).toBe('You have already reposted this post.')
  })

  it('falls back by code family for codes without an exact entry', () => {
    expect(messageForErrorCode('assignment_not_accessible')).toMatch(/could not be found/)
    expect(messageForErrorCode('verification_review_forbidden')).toMatch(/do not have permission/)
    expect(messageForErrorCode('learning_media_type_invalid')).toMatch(/could not be accepted/)
    expect(messageForErrorCode('course_create_failed')).toBe(GENERIC_RETRY_MESSAGE)
    expect(messageForErrorCode('legacy_company_already_exists')).toMatch(/already exists/)
  })

  it('uses the caller fallback for unknown codes and never leaks library messages', () => {
    expect(userFacingError(new Error('weird_unmapped'), 'Your post was not saved.')).toBe('Your post was not saved.')
    expect(userFacingError(new Error('connect ECONNREFUSED 10.0.0.1:5432'), 'Your post was not saved.')).toBe('Your post was not saved.')
    expect(userFacingError(null)).toBe(GENERIC_RETRY_MESSAGE)
  })

  it('turns an expired session into a sign-in instruction', () => {
    const error = Object.assign(new Error('Authentication required.'), { name: 'AwsAuthenticationRequiredError' })
    expect(userFacingError(error)).toBe(SESSION_EXPIRED_MESSAGE)
  })

  it('recognises raw codes and keeps real sentences as they are', () => {
    expect(isInternalErrorCode('organization_access_request_exists')).toBe(true)
    expect(isInternalErrorCode('This event is full.')).toBe(false)
    expect(displayableError('organization_membership_exists')).toBe('You are already a member of this organization.')
    expect(displayableError('Choose a date in the future.')).toBe('Choose a date in the future.')
    expect(displayableError('', 'Try again.')).toBe('Try again.')
  })
})
