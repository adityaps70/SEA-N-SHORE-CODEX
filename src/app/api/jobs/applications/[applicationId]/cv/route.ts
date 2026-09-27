import { z } from 'zod'
import { getVerifiedUser } from '@/features/auth/queries'
import { MAX_JOB_APPLICATION_CV_BYTES } from '@/features/jobs/application-media-policy'
import { hiringRepository } from '@/features/jobs/hiring-repository'
import { getMediaObject } from '@/lib/aws/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const applicationIdSchema = z.string().uuid()

function notFound() {
  return new Response('This CV is not available.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' },
  })
}

/** Plain ASCII fallback plus an RFC 5987 UTF-8 name, so any file name downloads safely. */
function contentDisposition(fileName: string, download: boolean) {
  const cleaned = fileName.replace(/[\r\n"\\/]+/g, ' ').trim() || 'cv.pdf'
  const withExtension = cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`
  const ascii = withExtension.replace(/[^\x20-\x7e]+/g, '_')
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(withExtension)}`
}

function unavailableRedirect(request: Request, viewer: 'applicant' | 'hiring', applicationId: string, reason: 'missing' | 'unavailable') {
  const path = viewer === 'hiring'
    ? `/hiring/applicants/${applicationId}?cv=${reason}`
    : `/jobs/applications?cv=${reason}`
  return Response.redirect(new URL(path, request.url), 303)
}

/**
 * Streams an application CV to the applicant or to someone authorized to manage the job.
 * The S3 object is never exposed by URL; every request is authorized against the database.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
): Promise<Response> {
  const viewer = await getVerifiedUser()
  if (!viewer) {
    return new Response('Sign in to Sea N Shore to open this CV.', {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' },
    })
  }

  const { applicationId } = await context.params
  const parsed = applicationIdSchema.safeParse(applicationId)
  if (!parsed.success) return notFound()

  const access = await hiringRepository.getApplicationCvAccess(viewer.id, parsed.data)
  if (!access) return notFound()
  if (!access.cv || !access.cv.storagePath.startsWith('job-applications/')) {
    return unavailableRedirect(request, access.viewer, parsed.data, 'missing')
  }

  try {
    const object = await getMediaObject({ key: access.cv.storagePath, maxBytes: MAX_JOB_APPLICATION_CV_BYTES })
    const download = new URL(request.url).searchParams.get('download') === '1'
    return new Response(Uint8Array.from(object.body).buffer, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(object.contentLength),
        'content-disposition': contentDisposition(access.cv.fileName, download),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    })
  } catch (error) {
    const missing = error instanceof Error && (error.name === 'NoSuchKey' || error.name === 'NotFound')
    console.error('job_application_cv_download_failed', {
      applicationId: parsed.data,
      name: error instanceof Error ? error.name : null,
      message: error instanceof Error ? error.message : null,
    })
    return unavailableRedirect(request, access.viewer, parsed.data, missing ? 'missing' : 'unavailable')
  }
}
