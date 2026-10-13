import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const unmuteAction = vi.fn<(id: string) => Promise<{ ok: true }>>(async () => ({ ok: true }))
vi.mock('@/features/signals/actions', () => ({ unmuteAction: (id: string) => unmuteAction(id) }))

const { MutedList } = await import('./muted-list')

afterEach(() => cleanup())

describe('MutedList', () => {
  it('lists muted members and organizations, each with Unmute', async () => {
    render(<MutedList items={[
      { id: '11111111-1111-4111-8111-111111111111', kind: 'person', name: 'Placeholder Member', slug: 'placeholder-member', subtitle: null, mutedOn: '13 Oct 2026' },
      { id: '22222222-2222-4222-8222-222222222222', kind: 'org', name: 'Placeholder Lines', slug: 'placeholder-lines', subtitle: null, mutedOn: '13 Oct 2026' },
    ]} />)
    expect(screen.getByRole('link', { name: 'Placeholder Member' })).toHaveAttribute('href', '/people/placeholder-member')
    expect(screen.getByRole('link', { name: 'Placeholder Lines' })).toHaveAttribute('href', '/organizations/placeholder-lines')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unmute Placeholder Member' }))
    })
    expect(unmuteAction).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    expect(screen.getByRole('status')).toHaveTextContent('Unmuted')
  })

  it('explains how to mute when nobody is muted', () => {
    render(<MutedList items={[]} />)
    expect(screen.getByText(/Use “Mute” in a post’s ⋯ menu/)).toBeInTheDocument()
  })
})
