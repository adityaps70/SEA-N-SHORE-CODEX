import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_BANNER_DISMISS_KEY, ProfileCompletionBanner } from './profile-completion-banner'

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProfileCompletionBanner', () => {
  it('shows the percentage and the next step, linking to the profile editor, on phones only', () => {
    render(<ProfileCompletionBanner completion={80} hint="Add sea service to get better job matches" />)
    const banner = screen.getByTestId('profile-completion-banner')
    expect(banner).toHaveClass('md:hidden')
    const link = screen.getByRole('link', { name: /complete your profile 80%/i })
    expect(link).toHaveAttribute('href', '/profile/edit')
    expect(link).toHaveTextContent('Add sea service to get better job matches')
  })

  it('is not shown once the profile is complete', () => {
    render(<ProfileCompletionBanner completion={100} hint={null} />)
    expect(screen.queryByTestId('profile-completion-banner')).not.toBeInTheDocument()
  })

  it('can be dismissed, and stays dismissed on this device until the completion changes', () => {
    const { unmount } = render(<ProfileCompletionBanner completion={80} hint={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss profile reminder' }))
    expect(screen.queryByTestId('profile-completion-banner')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(PROFILE_BANNER_DISMISS_KEY)).toBe('80')
    unmount()

    const { unmount: unmountAgain } = render(<ProfileCompletionBanner completion={80} hint={null} />)
    expect(screen.queryByTestId('profile-completion-banner')).not.toBeInTheDocument()
    unmountAgain()

    render(<ProfileCompletionBanner completion={90} hint={null} />)
    expect(screen.getByTestId('profile-completion-banner')).toBeInTheDocument()
  })

  it('still dismisses when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<ProfileCompletionBanner completion={40} hint={null} />)
    expect(screen.getByTestId('profile-completion-banner')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss profile reminder' }))
    expect(screen.queryByTestId('profile-completion-banner')).not.toBeInTheDocument()
  })
})
