import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getCertificateByVerificationCode: vi.fn() }))
vi.mock('@/features/learning/certificate-repository', () => ({
  certificateRepository: { getCertificateByVerificationCode: mocks.getCertificateByVerificationCode },
}))

import CertificateVerificationPage from './page'

const verificationCode = '55555555-5555-4555-8555-555555555555'

afterEach(() => cleanup())

describe('/certificates/[verificationCode]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows immutable verified certificate evidence', async () => {
    mocks.getCertificateByVerificationCode.mockResolvedValue({
      certificateId: '44444444-4444-4444-8444-444444444444',
      certificateNumber: 'SNS-2026-A1B2C3D4E5F6',
      verificationCode,
      learnerName: 'Aarav Mehta',
      courseTitle: 'SIRE 2.0 Readiness',
      mentorName: 'Capt. Maya Singh',
      completedAt: '2026-09-15T08:00:00.000Z',
      issuedAt: '2026-09-15T08:01:00.000Z',
    })

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
})
