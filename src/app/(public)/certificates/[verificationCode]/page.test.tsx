import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCertificateByVerificationCode: vi.fn(),
  getVerifiedUser: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/learning/certificate-repository', () => ({
  certificateRepository: { getCertificateByVerificationCode: mocks.getCertificateByVerificationCode },
}))

import CertificateVerificationPage, { generateMetadata } from './page'
import CertificateNotFound, { metadata as notFoundMetadata } from './not-found'

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

  it('shows a self-issued certificate as self-issued, not verified, with the issuer and a course link (Round H, H2)', async () => {
    mocks.getCertificateByVerificationCode.mockResolvedValue({ ...certificate, issuerRelation: 'self_issued', courseSlug: 'sire-2-readiness' })
    render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))
    expect(screen.getByRole('heading', { name: 'Self-issued certificate' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Certificate verified' })).not.toBeInTheDocument()
    expect(screen.getByText(/Sea N Shore does not verify it/)).toBeInTheDocument()
    expect(screen.getByText('Issued by')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'SIRE 2.0 Readiness' })).toHaveAttribute('href', '/learn/courses/sire-2-readiness')
  })

  it('shows the course as plain text once it is no longer published', async () => {
    mocks.getCertificateByVerificationCode.mockResolvedValue({ ...certificate, issuerRelation: 'independent', courseSlug: null })
    render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))
    expect(screen.getByRole('heading', { name: 'Certificate verified' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'SIRE 2.0 Readiness' })).not.toBeInTheDocument()
  })

  it('shows holder, course, issue date, valid until and Valid for a certificate with an expiry (round B)', async () => {
    mocks.getCertificateByVerificationCode.mockResolvedValue({ ...certificate, templateKey: 'formal', serialNumber: 'SNS-SIRE-2026-1A2B3C4D', expiresAt: '2099-01-31T00:00:00.000Z', signatoryName: null, signatoryTitle: null })
    render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))
    expect(screen.getByText('Certificate holder')).toBeInTheDocument()
    expect(screen.getByText('SNS-SIRE-2026-1A2B3C4D')).toBeInTheDocument()
    expect(screen.getByText('31 January 2099')).toBeInTheDocument()
    expect(screen.getByText('Valid')).toHaveAttribute('data-certificate-status', 'valid')
  })

  it('says Expired once the validity has passed, and "No expiry" for certificates without one', async () => {
    mocks.getCertificateByVerificationCode.mockResolvedValue({ ...certificate, expiresAt: '2026-01-31T00:00:00.000Z' })
    render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))
    expect(screen.getByText('Expired on 31 January 2026')).toHaveAttribute('data-certificate-status', 'expired')
    cleanup()
    mocks.getCertificateByVerificationCode.mockResolvedValue(certificate)
    render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))
    expect(screen.getByText('No expiry')).toBeInTheDocument()
    expect(screen.getByText('Valid')).toBeInTheDocument()
  })

  it('fails closed with an honest invalid certificate state', async () => {
    mocks.getCertificateByVerificationCode.mockResolvedValue(null)
    render(await CertificateVerificationPage({ params: Promise.resolve({ verificationCode }) }))
    expect(screen.getByRole('heading', { name: 'Certificate not verified' })).toBeInTheDocument()
    expect(screen.getByText(/No Sea N Shore Learning certificate matches this verification code/)).toBeInTheDocument()
  })

  it('answers 404 with the same "not verified" page for a code that is not a UUID, without querying (round C)', async () => {
    for (const code of ['abc', '0000000000000000', `${verificationCode}x`, "' or 1=1 --"]) {
      await expect(CertificateVerificationPage({ params: Promise.resolve({ verificationCode: code }) })).rejects.toThrow('NEXT_NOT_FOUND')
    }
    expect(mocks.notFound).toHaveBeenCalledTimes(4)
    expect(mocks.getCertificateByVerificationCode).not.toHaveBeenCalled()

    render(await CertificateNotFound())
    expect(screen.getByRole('heading', { name: 'Certificate not verified' })).toBeInTheDocument()
    expect(screen.getByText(/No Sea N Shore Learning certificate matches this verification code/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Join now' })).toHaveAttribute('href', '/auth/sign-up')
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

  describe('metadata (Round H, H5)', () => {
    it('names the course, not the holder, ignores the root title template and is not indexed', async () => {
      mocks.getCertificateByVerificationCode.mockResolvedValue(certificate)
      const metadata = await generateMetadata({ params: Promise.resolve({ verificationCode }) })
      expect(metadata.title).toEqual({ absolute: 'Certificate · SIRE 2.0 Readiness · Sea N Shore' })
      expect(metadata.description).toBe('Certificate of completion for SIRE 2.0 Readiness issued on Sea N Shore Learning.')
      expect(JSON.stringify(metadata)).not.toContain('Aarav Mehta')
      expect(metadata.robots).toEqual({ index: false })
      expect(metadata.alternates).toBeUndefined()
    })

    it('says "Certificate not found" for an unknown code, and for a malformed one without querying', async () => {
      mocks.getCertificateByVerificationCode.mockResolvedValue(null)
      const unknown = await generateMetadata({ params: Promise.resolve({ verificationCode }) })
      expect(unknown.title).toEqual({ absolute: 'Certificate not found · Sea N Shore' })
      expect(unknown.robots).toEqual({ index: false })

      mocks.getCertificateByVerificationCode.mockClear()
      const malformed = await generateMetadata({ params: Promise.resolve({ verificationCode: 'abc' }) })
      expect(malformed.title).toEqual({ absolute: 'Certificate not found · Sea N Shore' })
      expect(mocks.getCertificateByVerificationCode).not.toHaveBeenCalled()
      // The 404 page (malformed codes) shows the same "not verified" state under the same title.
      expect(notFoundMetadata).toEqual(unknown)
    })
  })
})
