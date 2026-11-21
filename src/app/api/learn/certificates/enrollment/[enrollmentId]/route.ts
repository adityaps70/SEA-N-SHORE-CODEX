import { requireAwsUser } from '@/features/auth/aws-queries'
import { buildLearningCertificatePdf, type CertificateImage } from '@/features/learning/certificate-pdf'
import { certificateRepository } from '@/features/learning/certificate-repository'
import { certificateDisplayNumber } from '@/features/learning/certificate-settings'
import { getMediaObject } from '@/lib/aws/storage'
import { siteUrlFor } from '@/lib/site-url'
import { backgroundFetchRefused, isBackgroundFetch } from '@/lib/http/background-fetch'

/** The logo or signature copied onto the certificate; a missing picture never stops the download. */
async function readImage(path: string | null | undefined): Promise<CertificateImage | null> {
  if (!path) return null
  try {
    const object = await getMediaObject({ key: path, maxBytes: 2 * 1024 * 1024 })
    return { bytes: object.body, contentType: object.contentType }
  } catch {
    return null
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ enrollmentId: string }> },
) {
  // Owner (21 Nov): a prefetch never issues a certificate or builds a PDF; only a person's own download does.
  if (isBackgroundFetch(request.headers)) return backgroundFetchRefused()
  const user = await requireAwsUser()
  const { enrollmentId } = await params

  try {
    const certificate = await certificateRepository.ensureCertificateForEnrollment(user.id, enrollmentId)
    if (!certificate) return new Response('Certificate not available', { status: 404 })

    const verificationUrl = siteUrlFor(`/certificates/${certificate.verificationCode}`).toString()
    const [logo, signature] = await Promise.all([readImage(certificate.logoPath), readImage(certificate.signaturePath)])
    const bytes = await buildLearningCertificatePdf({ certificate, verificationUrl, images: { logo, signature } })

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${certificateDisplayNumber(certificate)}.pdf"`,
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'certificate_enrollment_not_accessible') {
      return new Response('Not found', { status: 404 })
    }
    throw error
  }
}
