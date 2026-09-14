import { requireAwsUser } from '@/features/auth/aws-queries'
import { buildLearningCertificatePdf } from '@/features/learning/certificate-pdf'
import { certificateRepository } from '@/features/learning/certificate-repository'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ enrollmentId: string }> },
) {
  const user = await requireAwsUser()
  const { enrollmentId } = await params

  try {
    const certificate = await certificateRepository.ensureCertificateForEnrollment(user.id, enrollmentId)
    if (!certificate) return new Response('Certificate not available', { status: 404 })

    const origin = new URL(request.url).origin
    const verificationUrl = `${origin}/certificates/${certificate.verificationCode}`
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
