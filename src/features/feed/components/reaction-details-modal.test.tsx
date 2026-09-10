import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactionSummary } from '../types'
import { ReactionDetailsModal } from './reaction-details-modal'

const mocks = vi.hoisted(() => ({
  loadReactionDetails: vi.fn(),
}))

vi.mock('../actions', () => ({
  loadReactionDetails: mocks.loadReactionDetails,
}))

const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const summary: ReactionSummary = { like: 2, support: 1, respect: 0, on_point: 0 }

const allPage = {
  reactors: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'captain-a',
      fullName: 'Captain A',
      avatarPath: null,
      avatarUrl: null,
      headline: 'Master Mariner',
      rank: 'Master',
      currentCompany: 'Oceanic Shipping',
      reaction: 'like' as const,
      reactedAt: '2026-09-10T09:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'officer-b',
      fullName: 'Officer B',
      avatarPath: null,
      avatarUrl: null,
      headline: null,
      rank: 'Chief Officer',
      currentCompany: 'Blue Fleet',
      reaction: 'support' as const,
      reactedAt: '2026-09-10T08:59:00.000Z',
    },
  ],
  nextCursor: null,
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadReactionDetails.mockResolvedValue({ ok: true, page: allPage })
})

describe('ReactionDetailsModal', () => {
  it('loads only when opened and shows All plus only non-zero reaction tabs with reactor identities', async () => {
    const { rerender } = render(<ReactionDetailsModal
      open={false}
      targetType="post"
      targetId={targetId}
      summary={summary}
      onClose={vi.fn()}
    />)

    expect(mocks.loadReactionDetails).not.toHaveBeenCalled()

    rerender(<ReactionDetailsModal
      open
      targetType="post"
      targetId={targetId}
      summary={summary}
      onClose={vi.fn()}
    />)

    await waitFor(() => expect(mocks.loadReactionDetails).toHaveBeenCalledWith({
      targetType: 'post',
      targetId,
      limit: 30,
    }))

    expect(screen.getByRole('dialog', { name: /reactions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /all.*3/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /like.*2/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /support.*1/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /respect/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /on point/i })).not.toBeInTheDocument()

    const captainLink = screen.getByRole('link', { name: 'Captain A' })
    expect(captainLink).toHaveAttribute('href', '/people/captain-a')
    const captainRow = captainLink.closest('li')
    expect(captainRow).not.toBeNull()
    if (captainRow) expect(within(captainRow).getByText('👍')).toBeInTheDocument()
    expect(screen.getByText(/Master.*Oceanic Shipping/)).toBeInTheDocument()
  })

  it('reloads lazily when a reaction tab is selected', async () => {
    render(<ReactionDetailsModal
      open
      targetType="comment"
      targetId={targetId}
      summary={summary}
      onClose={vi.fn()}
    />)

    await waitFor(() => expect(mocks.loadReactionDetails).toHaveBeenCalledTimes(1))
    mocks.loadReactionDetails.mockResolvedValueOnce({
      ok: true,
      page: { reactors: [allPage.reactors[1]], nextCursor: null },
    })

    fireEvent.click(screen.getByRole('button', { name: /support.*1/i }))

    await waitFor(() => expect(mocks.loadReactionDetails).toHaveBeenLastCalledWith({
      targetType: 'comment',
      targetId,
      reaction: 'support',
      limit: 30,
    }))
  })

  it('shows safe load errors and exposes a close control', async () => {
    const onClose = vi.fn()
    mocks.loadReactionDetails.mockResolvedValueOnce({ ok: false, error: 'We could not load reactions.' })

    render(<ReactionDetailsModal
      open
      targetType="post"
      targetId={targetId}
      summary={summary}
      onClose={onClose}
    />)

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load reactions.')
    fireEvent.click(screen.getByRole('button', { name: /close reactions/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
