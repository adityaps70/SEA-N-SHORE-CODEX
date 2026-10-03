import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `expected ${path} to exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('feed social interactions contract', () => {
  it('defines the approved four reactions for both posts and comments', () => {
    const types = source('src/features/feed/types.ts')
    for (const value of ['like', 'support', 'respect', 'on_point']) {
      expect(types).toContain(`'${value}'`)
    }
    for (const label of ['Like', 'Support', 'Respect', 'On Point']) {
      expect(types).toContain(label)
    }
  })

  it('removes the normal post category badge and exposes a shared reaction picker', () => {
    const card = source('src/features/feed/components/post-card.tsx')
    expect(card).not.toContain('POST_CATEGORY_LABELS[post.category]')
    expect(card).toContain('ReactionPicker')
  })

  it('shows one comment by default with more-comments and reply affordances', () => {
    const comments = source('src/features/feed/components/comment-thread.tsx')
    expect(comments).toContain('visible-top-level-comment')
    expect(comments).toMatch(/View.*more comments/)
    expect(comments).toContain('Reply')
    expect(comments).toContain('ReactionPicker')
  })

  it('adds emoji and mention-aware composing with profile-photo support', () => {
    const composer = source('src/features/feed/components/post-composer.tsx')
    expect(composer).toContain('Emoji')
    expect(composer).toContain('MentionInput')
    expect(composer).toContain('profile.avatarUrl')
  })

  it('adds the guarded additive social migration', () => {
    const path = 'infra/aws/database/migrations/0009_feed_social_interactions.sql'
    expect(existsSync(path)).toBe(true)
  })
})
