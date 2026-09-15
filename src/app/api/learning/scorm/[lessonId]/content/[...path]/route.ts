import { NextResponse } from 'next/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { resolveLearnerScormContentKey } from '@/features/learning/scorm-content-repository'
import { getMediaObject } from '@/lib/aws/storage'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ lessonId: string; path: string[] }> },
) {
  try {
    const { lessonId, path } = await context.params
    const user = await requireAwsUser()
    const relativePath = path.map((segment) => decodeURIComponent(segment)).join('/')
    const key = await resolveLearnerScormContentKey(user.id, lessonId, relativePath)
    const object = await getMediaObject({ key, maxBytes: 100 * 1024 * 1024 })

    return new Response(object.body, {
      status: 200,
      headers: {
        'Content-Type': object.contentType ?? 'application/octet-stream',
        'Content-Length': String(object.contentLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'SCORM content is not available.' }, { status: 404 })
  }
}
