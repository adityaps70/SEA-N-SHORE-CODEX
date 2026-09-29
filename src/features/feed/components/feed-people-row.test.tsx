import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NetworkProfile } from '@/features/network/types'
import type { FeedPost } from '../types'
import { FeedList } from './feed-list'
import { FEED_PEOPLE_ROW_INTERVAL, FeedPeopleRow, peopleRowPositions } from './feed-people-row'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../actions', () => ({ loadFeedPage: vi.fn(async () => ({ ok: true, page: { posts: [], nextCursor: null } })) }))
vi.mock('./post-card', () => ({
  PostCard: ({ post, flushOnPhones }: { post: FeedPost; flushOnPhones?: boolean }) => (
    <article data-testid="post" data-flush={flushOnPhones ? 'true' : undefined}>{post.body}</article>
  ),
}))
vi.mock('@/features/network/components/connection-primary-action', () => ({
  ConnectionPrimaryAction: ({ profileId }: { profileId: string }) => <button type="button" data-profile={profileId}>Connect</button>,
}))

function person(id: string, overrides: Partial<NetworkProfile> = {}): NetworkProfile {
  return {
    id,
    slug: `person-${id}`,
    profileType: 'seafarer',
    fullName: `Person ${id}`,
    avatarPath: null,
    location: null,
    headline: 'Marine engineer',
    summary: null,
    rank: 'Second Engineer',
    currentCompany: null,
    currentVessel: null,
    sailingExperienceYears: null,
    vesselTypes: [],
    tradingAreas: [],
    shoreCareerPreference: false,
    availability: null,
    skills: [],
    relationship: { following: false, connection: { kind: 'none', connectionId: null } },
    ...overrides,
  } as NetworkProfile
}

function post(index: number): FeedPost {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  return {
    id,
    category: 'technical_discussion',
    body: `Post ${index}`,
    postType: 'standard',
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-10T09:00:00.000Z',
    author: { id: `author-${index}`, slug: `author-${index}`, fullName: `Author ${index}`, avatarPath: null, headline: null, rank: null, currentCompany: null },
    media: null,
    poll: null,
    likeCount: 0,
    viewerLiked: false,
    commentCount: 0,
    viewerSaved: false,
    comments: [],
  }
}

afterEach(() => cleanup())

describe('peopleRowPositions', () => {
  it('places the row after every 8 posts', () => {
    expect(FEED_PEOPLE_ROW_INTERVAL).toBe(8)
    expect([...peopleRowPositions(8)]).toEqual([7])
    expect([...peopleRowPositions(17)]).toEqual([7, 15])
    expect([...peopleRowPositions(24)]).toEqual([7, 15, 23])
  })

  it('places it after the last post of a short feed, and nowhere in an empty one', () => {
    expect([...peopleRowPositions(3)]).toEqual([2])
    expect([...peopleRowPositions(0)]).toEqual([])
  })
})

describe('FeedPeopleRow', () => {
  it('is a phone-only swipe row of cards with photo, name, rank and Connect', () => {
    render(<FeedPeopleRow profiles={[person('a'), person('b', { rank: null, headline: 'Port captain' })]} />)
    const row = screen.getByRole('region', { name: 'People you may know' })
    expect(row).toHaveClass('md:hidden')
    expect(within(row).getByRole('list')).toHaveClass('overflow-x-auto', 'snap-x')
    expect(within(row).getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/network')

    const cards = within(row).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]!).getByRole('link', { name: /Person a/ })).toHaveAttribute('href', '/people/person-a')
    expect(cards[0]).toHaveTextContent('Second Engineer')
    expect(cards[1]).toHaveTextContent('Port captain')
    expect(within(cards[0]!).getByRole('button', { name: 'Connect' })).toHaveAttribute('data-profile', 'a')
  })

  it('leaves out organization pages and renders nothing without people', () => {
    const { container } = render(<FeedPeopleRow profiles={[person('org', { profileType: 'company' }), person('root', { identityRoot: 'organisation' })]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('FeedList people row', () => {
  const suggestions = [person('a'), person('b')]

  it('inserts the row after every 8 posts on phones', () => {
    const posts = Array.from({ length: 17 }, (_, index) => post(index + 1))
    const { container } = render(<FeedList initialPage={{ posts, nextCursor: null }} suggestions={suggestions} />)

    const children = [...container.firstElementChild!.children]
    const rowIndexes = children.flatMap((child, index) => child.getAttribute('data-testid') === 'feed-people-row' ? [index] : [])
    expect(rowIndexes).toEqual([8, 17])
    expect(children[7]).toHaveTextContent('Post 8')
    expect(children[9]).toHaveTextContent('Post 9')
    expect(children[16]).toHaveTextContent('Post 16')
  })

  it('shows posts edge to edge on phones and the new-posts pill below the phone top bar', () => {
    const { container } = render(<FeedList initialPage={{ posts: [post(1)], nextCursor: null }} suggestions={[]} />)
    expect(container.firstElementChild).toHaveClass('max-md:-mx-4', 'max-md:space-y-2')
    expect(screen.getByTestId('post')).toHaveAttribute('data-flush', 'true')
    expect(screen.queryByTestId('feed-people-row')).not.toBeInTheDocument()
  })

  it('offers the full-screen composer and suggestions from an empty feed on phones', () => {
    render(<FeedList initialPage={{ posts: [], nextCursor: null }} suggestions={suggestions} />)
    const links = screen.getAllByRole('link', { name: 'Publish an update' })
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/home?compose=update', '#feed-composer'])
    expect(links[0]).toHaveClass('md:hidden')
    expect(links[1]).toHaveClass('max-md:hidden')
    expect(screen.getByTestId('feed-people-row')).toBeInTheDocument()
  })
})
