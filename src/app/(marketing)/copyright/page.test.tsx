import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import CopyrightPage from './page'

describe('CopyrightPage', () => {
  it('explains how to report content without a sign-in call to action', () => {
    render(<CopyrightPage />)

    expect(screen.getByRole('heading', { name: 'Copyright & Intellectual Property Policy' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How to report copyrighted or infringing content' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Read Terms' })).toHaveAttribute('href', '/terms')
    expect(screen.queryByRole('link', { name: /sign in to report content/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/sign in to report/i)).not.toBeInTheDocument()
  })
})
