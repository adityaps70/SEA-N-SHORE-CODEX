import { cleanup, render, screen, within } from '@testing-library/react'
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

describe('MentionText Markdown (Round H)', () => {
  const member = { profileId: '44444444-4444-4444-8444-444444444444', slug: 'member-a', fullName: 'Member A' }

  it('renders bold and italic instead of the raw markers', () => {
    const { container } = render(<MentionText body="**Good Morning!** from *the* _bridge_" />)
    expect(container).toHaveTextContent('Good Morning! from the bridge')
    expect(container).not.toHaveTextContent('*')
    expect(container.querySelector('strong')).toHaveTextContent('Good Morning!')
    expect([...container.querySelectorAll('em')].map((element) => element.textContent)).toEqual(['the', 'bridge'])
  })

  it('renders bulleted and numbered lists', () => {
    render(<MentionText body={'Kit:\n- Lifejacket\n* Torch\nSteps:\n1. Muster\n2. Report'} />)
    const [bulleted, numbered] = screen.getAllByRole('list')
    expect(within(bulleted!).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['•Lifejacket', '•Torch'])
    expect(within(numbered!).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['1.Muster', '2.Report'])
  })

  it('links http(s) targets in a new tab with nofollow and same-site paths in place', () => {
    render(<MentionText body="Read [the guide](https://example.com/guide) and [open jobs](/jobs)" />)
    const external = screen.getByRole('link', { name: /the guide/ })
    expect(external).toHaveAttribute('href', 'https://example.com/guide')
    expect(external).toHaveAttribute('target', '_blank')
    expect(external).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer')
    const internal = screen.getByRole('link', { name: 'open jobs' })
    expect(internal).toHaveAttribute('href', '/jobs')
    expect(internal).not.toHaveAttribute('target')
  })

  it('keeps mentions and hashtags as links, also inside bold', () => {
    render(<MentionText body="**Thanks @Member A** for #Safety" mentions={[member]} />)
    const mention = screen.getByRole('link', { name: '@Member A' })
    expect(mention).toHaveAttribute('href', '/people/member-a')
    expect(mention.closest('strong')).not.toBeNull()
    expect(screen.getByRole('link', { name: '#Safety' })).toHaveAttribute('href', '/hashtags/safety')
  })

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](data:text/html,<script>alert(1)</script>)',
    '[x](//evil.example)',
  ])('renders %s as inert literal text', (body) => {
    const { container } = render(<MentionText body={body} />)
    expect(container).toHaveTextContent(body)
    expect(container.querySelector('script, img, iframe')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('[href^="javascript" i], [onerror]')).toBeNull()
  })
})
