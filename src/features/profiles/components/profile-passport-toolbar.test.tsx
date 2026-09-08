import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfilePassportToolbar } from './profile-passport-toolbar'

vi.mock('./profile-share-controls', () => ({
  ProfileShareControls: ({ slug, siteUrl }: { slug: string; siteUrl?: string }) => (
    <div data-testid="profile-share-controls">{slug}:{siteUrl ?? ''}</div>
  ),
}))

afterEach(() => cleanup())

describe('ProfilePassportToolbar', () => {
  it('uses the real share and QR controls while keeping public profile and CV actions', () => {
    render(<ProfilePassportToolbar slug="captain-example" siteUrl="https://seaandshore.in" />)

    expect(screen.getByRole('link', { name: /view public profile/i })).toHaveAttribute('href', '/people/captain-example')
    expect(screen.getByTestId('profile-share-controls')).toHaveTextContent('captain-example:https://seaandshore.in')
    expect(screen.getByRole('link', { name: /download cv/i })).toHaveAttribute('href', '/api/profile/cv')
    expect(screen.queryByRole('link', { name: /qr profile/i })).not.toBeInTheDocument()
  })
})
