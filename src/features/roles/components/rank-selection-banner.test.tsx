import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ updateProfileRoleSection: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/features/profiles/profile-inline-actions', () => ({ updateProfileRoleSection: mocks.updateProfileRoleSection }))

import { RankSelectionBanner } from './rank-selection-banner'

beforeEach(() => {
  window.localStorage.clear()
  mocks.updateProfileRoleSection.mockResolvedValue({ success: true, revision: 1 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RankSelectionBanner (round 12)', () => {
  it('opens the rank picker in place and clears itself once saved', async () => {
    render(<RankSelectionBanner persona="seafarer" initial={{ legacyRank: 'Sea wizard' }} />)
    expect(screen.getByText('Select your rank so jobs can match you')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Select rank' }))
    expect(screen.getByText('Saved as “Sea wizard”. Pick it from the list so jobs can match you.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'deck_officers' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Current or most recent rank' }), { target: { value: 'second_officer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.updateProfileRoleSection).toHaveBeenCalledTimes(1))
    const data = mocks.updateProfileRoleSection.mock.calls[0]![1] as FormData
    expect(data.get('roleKey')).toBe('second_officer')
    await waitFor(() => expect(screen.queryByTestId('rank-selection-banner')).not.toBeInTheDocument())
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('stays dismissed once dismissed', () => {
    const { unmount } = render(<RankSelectionBanner persona="student_cadet" initial={{}} />)
    expect(screen.getByText('Select your target job role so jobs can match you')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('rank-selection-banner')).not.toBeInTheDocument()
    unmount()
    render(<RankSelectionBanner persona="student_cadet" initial={{}} />)
    expect(screen.queryByTestId('rank-selection-banner')).not.toBeInTheDocument()
  })
})
