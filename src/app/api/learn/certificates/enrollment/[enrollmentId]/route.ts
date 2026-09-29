import { requireAwsUser } from '@/features/auth/aws-queries'
import { buildLearningCertificatePdf } from '@/features/learning/certificate-pdf'
import { certificateRepository } from '@/features/learning/certificate-repository'
import { siteUrlFor } from '@/lib/site-url'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ enrollmentId: string }> },
) {
  const user = await requireAwsUser()
  const { enrollmentId } = await params

  try {
    const certificate = await certificateRepository.ensureCertificateForEnrollment(user.id, enrollmentId)
    if (!certificate) return new Response('Certificate not available', { status: 404 })

    const verificationUrl = siteUrlFor(`/certificates/${certificate.verificationCode}`).toString()
    const bytes = await buildLearningCertificatePdf({ certificate, verificationUrl })

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${certificate.certificateNumber}.pdf"`,
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
