import { describe, expect, it } from 'vitest'
import { postShareDescription, publicPostMetadata } from './post-seo'
import type { FeedPost } from './types'

function post(body: string): FeedPost {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    category: 'general',
    body,
    postType: 'text',
    audience: 'anyone',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    author: { fullName: 'Capt. Maya Singh' },
    media: null,
    poll: null,
    likeCount: 0,
    viewerLiked: false,
    commentCount: 0,
    viewerSaved: false,
  } as unknown as FeedPost
}

describe('post share descriptions', () => {
  it('keeps short text as it is, on one line', () => {
    expect(postShareDescription('Mooring checks\n\ncompleted   today.')).toBe('Mooring checks completed today.')
  })

  it('cuts long text at a word, within 160 characters', () => {
    const description = postShareDescription('Safe mooring starts with a proper briefing and the right gear on deck. '.repeat(5))
    expect(description.length).toBeLessThanOrEqual(160)
    expect(description.endsWith('…')).toBe(true)
    expect(description).not.toMatch(/\s…$/)
  })

  it('strips Markdown markers and emoji (Round H, H5)', () => {
    const body = '**Good Morning, crew!** 🌊⚓\n\n- Read the _new_ [mooring checklist](https://example.com/checklist) 👍\n# Stay safe'
    expect(postShareDescription(body)).toBe('Good Morning, crew! Read the new mooring checklist Stay safe')
    expect(publicPostMetadata(post(body)).description).toBe('Good Morning, crew! Read the new mooring checklist Stay safe')
  })

  it('falls back to a generic line for a post with nothing but emoji', () => {
    expect(publicPostMetadata(post('🌊⚓')).description).toBe('A post by Capt. Maya Singh on Sea N Shore.')
  })
})
