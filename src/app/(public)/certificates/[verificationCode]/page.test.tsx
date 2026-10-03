import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getCertificateByVerificationCode: vi.fn(), getVerifiedUser: vi.fn() }))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/learning/certificate-repository', () => ({
  certificateRepository: { getCertificateByVerificationCode: mocks.getCertificateByVerificationCode },
}))

import CertificateVerificationPage from './page'

const verificationCode = '55555555-5555-4555-8555-555555555555'
const certificate = {
  certificateId: '44444444-4444-4444-8444-444444444444',
  certificateNumber: 'SNS-2026-A1B2C3D4E5F6',
  verificationCode,
  learnerName: 'Aarav Mehta',
  courseTitle: 'SIRE 2.0 Readiness',
  mentorName: 'Capt. Maya Singh',
  completedAt: '2026-09-15T08:00:00.000Z',
  issuedAt: '2026-09-15T08:01:00.000Z',
}

afterEach(() => cleanup())

describe('/certificates/[verificationCode]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVerifiedUser.mockResolvedValue(null)
  })

  it('shows immutable verified certificate evidence', async () => {
    mocks.getCertificateByVerificationCode.mockResolvedValue(certificate)

    render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))

    expect(mocks.getCertificateByVerificationCode).toHaveBeenCalledWith(verificationCode)
    expect(screen.getByRole('heading', { name: 'Certificate verified' })).toBeInTheDocument()
    expect(screen.getByText('Aarav Mehta')).toBeInTheDocument()
    expect(screen.getByText('SIRE 2.0 Readiness')).toBeInTheDocument()
    expect(screen.getByText('Capt. Maya Singh')).toBeInTheDocument()
    expect(screen.getByText('SNS-2026-A1B2C3D4E5F6')).toBeInTheDocument()
  })

  it('fails closed with an honest invalid certificate state', async () => {
    mocks.getCertificateByVerificationCode.mockResolvedValue(null)
    render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))
    expect(screen.getByRole('heading', { name: 'Certificate not verified' })).toBeInTheDocument()
    expect(screen.getByText(/No Sea N Shore Learning certificate matches this verification code/)).toBeInTheDocument()
  })

  it('shows signed-out visitors a slim "Join Sea N Shore" bar on phones that leads to sign-up', async () => {
    mocks.getCertificateByVerificationCode.mockResolvedValue(certificate)
    const { container } = render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))

    const bar = screen.getByRole('complementary', { name: 'Join Sea N Shore' })
    expect(bar).toHaveClass('md:hidden', 'sticky', 'bottom-0')
    expect(within(bar).getByRole('link', { name: 'Join now' })).toHaveAttribute('href', '/auth/sign-up')
    // Right after the certificate, so it never covers the footer.
    expect(container.querySelector('main')?.nextElementSibling).toBe(bar)
  })

  it('also invites visitors to join from the not-verified state', async () => {
    mocks.getCertificateByVerificationCode.mockResolvedValue(null)
    render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))
    expect(screen.getByRole('link', { name: 'Join now' })).toHaveAttribute('href', '/auth/sign-up')
  })

  it('does not show the join bar to signed-in members', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: 'user-1' })
    mocks.getCertificateByVerificationCode.mockResolvedValue(certificate)
    const { container } = render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))
    expect(screen.getByRole('heading', { name: 'Certificate verified' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Join Sea N Shore' })).not.toBeInTheDocument()
    expect(container.querySelector('[data-certificate-join-bar]')).toBeNull()
  })

  it('still renders, as for a visitor, when the session cannot be checked', async () => {
    mocks.getVerifiedUser.mockRejectedValue(new Error('cognito down'))
    mocks.getCertificateByVerificationCode.mockResolvedValue(certificate)
    render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))
    expect(screen.getByRole('heading', { name: 'Certificate verified' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Join now' })).toBeInTheDocument()
  })
})
