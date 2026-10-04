import { NextResponse } from 'next/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { injectScormBridge } from '@/features/learning/scorm-bridge'
import { SCORM_CONTENT_SANDBOX, isScormContentToken, verifyScormContentToken } from '@/features/learning/scorm-content-link'
import { resolveLearnerScormContentKey } from '@/features/learning/scorm-content-repository'
import { getMediaObject } from '@/lib/aws/storage'
import { siteOrigin } from '@/lib/site-url'

export const dynamic = 'force-dynamic'

/**
 * Serves extracted SCORM files. Round 14 (2.3): every response carries a CSP sandbox without
 * allow-same-origin, so package scripts run in an opaque origin, and HTML documents get the
 * postMessage SCORM bridge. The player loads packages through a signed path segment because the
 * sandboxed document's own requests do not carry the session cookie.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ lessonId: string; path: string[] }> },
) {
  try {
    const { lessonId, path } = await context.params
    const segments = path.map((segment) => decodeURIComponent(segment))
    let learnerId: string
    if (isScormContentToken(segments[0])) {
      const check = verifyScormContentToken(segments[0], lessonId)
      if (!check.ok) throw new Error('scorm_content_link_' + check.reason)
      learnerId = check.learnerId
      segments.shift()
    } else {
      learnerId = (await requireAwsUser()).id
    }
    const relativePath = segments.join('/')
    const key = await resolveLearnerScormContentKey(learnerId, lessonId, relativePath)
    const object = await getMediaObject({ key, maxBytes: 100 * 1024 * 1024 })
    const contentType = object.contentType ?? 'application/octet-stream'
    const body = /^text\/html\b/i.test(contentType)
      ? new TextEncoder().encode(injectScormBridge(Buffer.from(object.body).toString('utf8'), siteOrigin()))
      : Uint8Array.from(object.body)

    return new Response(body.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': SCORM_CONTENT_SANDBOX,
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch {
    return NextResponse.json({ error: 'SCORM content is not available.' }, { status: 404 })
  }
}
