import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TermsPage from './page'

describe('TermsPage', () => {
  it('explains user content ownership, platform licence and copyright complaints', () => {
    render(<TermsPage />)

    expect(screen.getByRole('heading', { name: /user content and intellectual property/i })).toBeVisible()
    expect(screen.getByText(/you retain ownership/i)).toBeVisible()
    expect(screen.getByText(/non-exclusive/i)).toBeVisible()
    expect(screen.getByRole('heading', { name: /copyright complaints and review/i })).toBeVisible()
    expect(screen.getByRole('link', { name: /copyright & ip policy/i })).toHaveAttribute('href', '/copyright')
  })
})
