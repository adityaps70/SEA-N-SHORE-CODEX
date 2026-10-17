import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'

/**
 * Round H (H2): the JSON errors API routes answer with, instead of a 500 or the HTML error page.
 * Same shape as /api/realtime/messaging-state: `{ error }`, never cached.
 */
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' }

export function jsonError(status: 401 | 403 | 404 | 405, error: string) {
  return Response.json({ error }, { status, headers: NO_STORE_HEADERS })
}

export function unauthorizedJson() {
  return jsonError(401, 'Sign in to continue.')
}

export function notFoundJson() {
  return jsonError(404, 'Not found.')
}

/** Runs an authenticated route body; a missing or expired sign-in becomes 401 JSON. */
export async function withAuthenticationJson(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) return unauthorizedJson()
    throw error
  }
}
