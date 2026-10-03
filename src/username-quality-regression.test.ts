import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('username quality regression', () => {
  it('keeps realtime availability checks debounced at 400 ms', () => {
    const usernameField = source('./features/profiles/components/username-field.tsx')
    expect(usernameField).toContain('}, 400)')
    expect(usernameField).toContain('checkUsernameAvailability')
  })

  it('keeps the public identity rendered as @username rather than a profile address', () => {
    const profileHeader = source('./features/profiles/components/profile-header.tsx')
    expect(profileHeader).toContain('@{profile.slug}')
  })

  it('keeps username edits capped at two', () => {
    const profileEditForm = source('./features/profiles/components/profile-edit-form.tsx')
    expect(profileEditForm).toContain('Math.max(0, 2 -')
    expect(profileEditForm).toContain('UsernameField')
  })
})
