import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildLearningCertificatePdf } from './certificate-pdf'

const certificate = {
  certificateId: '44444444-4444-4444-8444-444444444444',
  enrollmentId: '22222222-2222-4222-8222-222222222222',
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

describe('learning certificate pdf', () => {
  it('builds a valid one-page certificate with document metadata', async () => {
    const bytes = await buildLearningCertificatePdf({
      certificate,
      verificationUrl: 'https://seaandshore.in/certificates/55555555-5555-4555-8555-555555555555',
    })

    expect(bytes.byteLength).toBeGreaterThan(500)
    const document = await PDFDocument.load(bytes)
    expect(document.getPageCount()).toBe(1)
    expect(document.getTitle()).toContain('SIRE 2.0 Readiness')
    expect(document.getSubject()).toContain('Certificate of Completion')
    expect(document.getAuthor()).toBe('Sea N Shore Global Shipping Community')
  })
})

// A 1×1 PNG, standing in for a course's logo and signature.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))

describe('learning certificate pdf layouts (round B)', () => {
  it.each(['classic', 'modern', 'formal', 'minimal'] as const)('builds the %s layout with logo, signature, serial and expiry', async (templateKey) => {
    const bytes = await buildLearningCertificatePdf({
      certificate: {
        ...certificate,
        templateKey,
        serialNumber: 'SNS-SIRE-2026-1A2B3C4D',
        expiresAt: '2028-09-15T08:01:00.000Z',
        logoPath: 'learning/x/logo.png',
        signaturePath: 'learning/x/signature.png',
        signatoryName: 'Capt. Fixture Signatory',
        signatoryTitle: 'Course director',
        hiddenFromProfile: false,
        // A very long name must still fit the page.
        learnerName: 'Fixture Learner With An Exceptionally Long Name For Layout Testing Purposes',
      },
      verificationUrl: 'https://seanshore.in/certificates/55555555-5555-4555-8555-555555555555',
      images: { logo: { bytes: PNG, contentType: 'image/png' }, signature: { bytes: PNG, contentType: 'image/png' } },
    })
    const document = await PDFDocument.load(bytes)
    expect(document.getPageCount()).toBe(1)
  })

  it('still builds when a picture cannot be read', async () => {
    const bytes = await buildLearningCertificatePdf({
      certificate: { ...certificate, templateKey: 'modern', serialNumber: null, expiresAt: null, logoPath: 'x', signaturePath: null, signatoryName: null, signatoryTitle: null, hiddenFromProfile: false },
      verificationUrl: 'https://seanshore.in/certificates/x',
      images: { logo: { bytes: Uint8Array.from([1, 2, 3]), contentType: 'image/png' } },
    })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
})
