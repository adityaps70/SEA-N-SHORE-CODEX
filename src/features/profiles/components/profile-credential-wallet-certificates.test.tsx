import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setHidden: vi.fn() }))
vi.mock('@/features/learning/certificate-profile-actions', () => ({ setCertificateHiddenFromProfile: mocks.setHidden }))
vi.mock('../profile-portfolio-actions', () => ({ createProfileCredential: vi.fn(), updateProfileCredential: vi.fn(), deleteProfileCredential: vi.fn() }))

import { ProfileCredentialWallet } from './profile-credential-wallet'

const certificate = {
  certificateId: '44444444-4444-4444-8444-444444444444',
  courseTitle: 'SIRE 2.0 Readiness',
  issuer: 'Capt. Fixture Trainer',
  number: 'SNS-SIRE-2026-1A2B3C4D',
  issuedAt: '2026-10-09T08:00:00.000Z',
  expiresAt: '2026-10-01T08:00:00.000Z',
  verificationCode: '55555555-5555-4555-8555-555555555555',
  hidden: false,
  expired: true,
}

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('Sea N Shore certificates in Licences & Credentials', () => {
  it('shows issuer, dates, "Expired" and a link to the verification page on a public profile', () => {
    render(<ProfileCredentialWallet credentials={[]} learningCertificates={[certificate]} />)
    const group = screen.getByRole('group', { name: 'Sea N Shore certificates' })
    expect(within(group).getByText('SIRE 2.0 Readiness')).toBeInTheDocument()
    expect(within(group).getByText('Capt. Fixture Trainer · Sea N Shore Learning')).toBeInTheDocument()
    expect(within(group).getAllByText(/Expired/).length).toBeGreaterThan(0)
    expect(within(group).getByRole('link', { name: 'Verify' })).toHaveAttribute('href', `/certificates/${certificate.verificationCode}`)
    expect(within(group).queryByRole('button', { name: /Hide from profile/ })).not.toBeInTheDocument()
  })

  it('lets the owner hide a certificate (shown by default)', async () => {
    mocks.setHidden.mockResolvedValue({ ok: true })
    render(<ProfileCredentialWallet credentials={[]} learningCertificates={[{ ...certificate, expired: false, expiresAt: null }]} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide from profile' }))
    await waitFor(() => expect(mocks.setHidden).toHaveBeenCalledWith(certificate.certificateId, true))
    expect(await screen.findByText('Hidden from your profile')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show on profile' })).toHaveAttribute('aria-pressed', 'true')
  })
})
