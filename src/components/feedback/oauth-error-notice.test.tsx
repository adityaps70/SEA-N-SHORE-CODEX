import { describe, expect, it } from 'vitest'
import { oauthErrorMessage } from './oauth-error-notice'

describe('OAuthErrorNotice', () => {
  it('explains a post-sign-in session failure instead of failing silently', () => {
    expect(oauthErrorMessage('post-sign-in-session')).toMatch(/signed in with Google/i)
    expect(oauthErrorMessage('post-sign-in-session')).toMatch(/session/i)
  })

  it('explains a post-sign-in profile failure instead of failing silently', () => {
    expect(oauthErrorMessage('post-sign-in-profile')).toMatch(/profile/i)
    expect(oauthErrorMessage('post-sign-in-profile')).toMatch(/try again/i)
  })
})
