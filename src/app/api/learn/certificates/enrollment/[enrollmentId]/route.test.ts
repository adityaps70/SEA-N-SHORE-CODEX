import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  ensureCertificateForEnrollment: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/certificate-repository', () => ({
  certificateRepository: { ensureCertificateForEnrollment: mocks.ensureCertificateForEnrollment },
}))

const enrollmentId = '22222222-2222-4222-8222-222222222222'
const certificate = {
  certificateId: '44444444-4444-4444-8444-444444444444',
  enrollmentId,
  courseId: '33333333-3333-4333-8333-333333333333',
  learnerId: '11111111-1111-4111-8111-111111111111',
  certificateNumber: 'SNS-2026-A1B2C3D4E5F6',
  verificationCode: '55555555-5555-4555-8555-555555555555',
  learnerName: 'Aarav Mehta',
  courseTitle: 'SIRE 2.0 Readiness',
  mentorName: 'Capt. Maya Singh',
  completedAt: '2026-09-15T08:00:00.000Z',
  issuedAt: '2026-09-15T08:01:00.000Z',
}

describe('GET /api/learn/certificates/enrollment/[enrollmentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: certificate.learnerId })
    mocks.ensureCertificateForEnrollment.mockResolvedValue(certificate)
  })

  it('ensures the owned eligible certificate and returns a private PDF download', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new Request(`https://example.com/api/learn/certificates/enrollment/${enrollmentId}`),
      { params: Promise.resolve({ enrollmentId }) },
    )

    expect(mocks.ensureCertificateForEnrollment).toHaveBeenCalledWith(certificate.learnerId, enrollmentId)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/pdf')
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect(response.headers.get('content-disposition')).toContain(certificate.certificateNumber)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('returns 404 when an owned completed enrollment is not certificate eligible', async () => {
    mocks.ensureCertificateForEnrollment.mockResolvedValueOnce(null)
    const { GET } = await import('./route')
    const response = await GET(
      new Request(`https://example.com/api/learn/certificates/enrollment/${enrollmentId}`),
      { params: Promise.resolve({ enrollmentId }) },
    )
    expect(response.status).toBe(404)
  })
})
