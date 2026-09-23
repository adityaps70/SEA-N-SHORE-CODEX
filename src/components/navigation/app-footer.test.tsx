import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppFooter } from './app-footer'

describe('AppFooter', () => {
  it('shows copyright wording and legal reporting links', () => {
    render(<AppFooter />)

    expect(screen.getByText(/all rights reserved/i)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Copyright & IP' })).toHaveAttribute('href', '/copyright')
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
  })
})
