import { describe, expect, it } from 'vitest'
import { shouldShowWelcomePrompt, WELCOME_STARTER_QUESTIONS, welcomePostTemplate } from './welcome-post'

describe('welcome post (round H, H7)', () => {
  it('builds a welcome with the community purpose and three numbered starter questions', () => {
    const text = welcomePostTemplate({ name: 'Tanker Professionals', description: 'A place for tanker officers to share cargo lessons\nSecond line' })
    expect(text.startsWith('Welcome to Tanker Professionals!')).toBe(true)
    expect(text).toContain('A place for tanker officers to share cargo lessons. Introduce yourself below')
    expect(text).not.toContain('Second line')
    expect(WELCOME_STARTER_QUESTIONS).toHaveLength(3)
    WELCOME_STARTER_QUESTIONS.forEach((question, index) => expect(text).toContain(`${index + 1}. ${question}`))
  })

  it('works without a description and does not double the full stop', () => {
    expect(welcomePostTemplate({ name: 'Placeholder Community', description: null })).toContain('Welcome to Placeholder Community!\n\nIntroduce yourself below')
    expect(welcomePostTemplate({ name: 'Placeholder Community', description: 'Engine room tips.' })).toContain('Engine room tips. Introduce')
  })

  it('shows to owners until an owner or moderator has posted', () => {
    expect(shouldShowWelcomePrompt({ isOwner: true, postAuthorIds: [], moderatorIds: ['owner'] })).toBe(true)
    expect(shouldShowWelcomePrompt({ isOwner: true, postAuthorIds: ['member'], moderatorIds: ['owner'] })).toBe(true)
    expect(shouldShowWelcomePrompt({ isOwner: true, postAuthorIds: ['member', 'owner'], moderatorIds: ['owner'] })).toBe(false)
    expect(shouldShowWelcomePrompt({ isOwner: false, postAuthorIds: [], moderatorIds: ['owner'] })).toBe(false)
  })
})
