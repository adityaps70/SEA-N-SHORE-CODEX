import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AuthLayout, { dynamic, revalidate } from './layout'

describe('auth route cache policy', () => {
  it('renders auth pages from the current deployment instead of shared prerender cache', () => {
    expect(dynamic).toBe('force-dynamic')
    expect(revalidate).toBe(0)
  })

  it('keeps legal and copyright links available on authentication screens', () => {
    render(<AuthLayout><div>Auth form</div></AuthLayout>)

    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: 'Copyright & IP' })).toHaveAttribute('href', '/copyright')
    expect(screen.getByText(/all rights reserved/i)).toBeVisible()
  })
})
