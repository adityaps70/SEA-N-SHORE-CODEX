import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MentionText, segmentBody } from './mention-text'

afterEach(cleanup)

const rahul = { profileId: '22222222-2222-4222-8222-222222222222', slug: 'rahul-gupta', fullName: 'Rahul Gupta' }
const sire = { companyId: '33333333-3333-4333-8333-333333333333', slug: 'sire-marine', name: 'SIRE Marine', logoUrl: null }

describe('segmentBody', () => {
  it('splits members, organizations and hashtags out of plain text', () => {
    const body = 'Thanks @Rahul Gupta and @SIRE Marine for the #Vetting session #life_at_sea'
    expect(segmentBody(body, [rahul], [sire])).toEqual([
      { type: 'text', value: 'Thanks ' },
      { type: 'mention', value: '@Rahul Gupta', mention: rahul },
      { type: 'text', value: ' and ' },
      { type: 'organization', value: '@SIRE Marine', organization: sire },
      { type: 'text', value: ' for the ' },
      { type: 'hashtag', value: '#Vetting', tag: 'vetting' },
      { type: 'text', value: ' session ' },
      { type: 'hashtag', value: '#life_at_sea', tag: 'life_at_sea' },
    ])
  })

  it('lets mentions win when a label contains a "#"', () => {
    const csharp = { ...sire, name: 'C# Marine' }
    expect(segmentBody('Ask @C# Marine #tanker', [], [csharp])).toEqual([
      { type: 'text', value: 'Ask ' },
      { type: 'organization', value: '@C# Marine', organization: csharp },
      { type: 'text', value: ' ' },
      { type: 'hashtag', value: '#tanker', tag: 'tanker' },
    ])
  })

  it('leaves "#" in URLs and "@" in emails alone', () => {
    expect(segmentBody('Read https://example.com/page#top or mail me@ship.com', [rahul], [sire])).toEqual([
      { type: 'text', value: 'Read https://example.com/page#top or mail me@ship.com' },
    ])
  })

  it('does not link tags the database cannot store', () => {
    expect(segmentBody('#Größe and #safety', [], [])).toEqual([
      { type: 'text', value: '#Größe and ' },
      { type: 'hashtag', value: '#safety', tag: 'safety' },
    ])
  })

  it('keeps the old two-argument call working', () => {
    expect(segmentBody('Hi @Rahul Gupta', [rahul])).toEqual([
      { type: 'text', value: 'Hi ' },
      { type: 'mention', value: '@Rahul Gupta', mention: rahul },
    ])
  })
})

describe('MentionText', () => {
  it('links members to their profile, organizations to their page and hashtags to the hashtag page', () => {
    render(<MentionText body="Thanks @Rahul Gupta and @SIRE Marine for the #Vetting session" mentions={[rahul]} organizationMentions={[sire]} />)

    expect(screen.getByRole('link', { name: '@Rahul Gupta' })).toHaveAttribute('href', '/people/rahul-gupta')
    const organization = screen.getByRole('link', { name: '@SIRE Marine' })
    expect(organization).toHaveAttribute('href', '/organizations/sire-marine')
    expect(organization).toHaveClass('text-ocean-700')
    const hashtag = screen.getByRole('link', { name: '#Vetting' })
    expect(hashtag).toHaveAttribute('href', '/hashtags/vetting')
    expect(hashtag).toHaveClass('text-ocean-700')
  })

  it('renders text with URLs and emails without any links', () => {
    render(<MentionText body="Read https://example.com/page#top or mail me@ship.com" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Read https://example.com/page#top or mail me@ship.com')).toBeInTheDocument()
  })
})
