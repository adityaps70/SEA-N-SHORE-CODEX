import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/brand/wordmark', () => ({
  Wordmark: () => <div>Sea N Shore</div>,
}))

import AccountDeletedPage from './page'

describe('AccountDeletedPage', () => {
  it('confirms deletion and provides a signed-out route forward', () => {
    render(<AccountDeletedPage />)

    expect(screen.getByRole('heading', { name: 'Your account has been deleted' })).toBeInTheDocument()
    expect(screen.getByText(/sign-in identity has been removed/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Return to Sea N Shore' })).toHaveAttribute('href', '/')
  })
})
