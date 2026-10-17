import { notFoundJson } from '@/lib/http/json-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Round H (H2): any /api/* path without its own route answers 404 JSON instead of the HTML 404 page.
 * Every real route is more specific than this catch-all, so it never shadows one.
 */
function notFound() {
  return notFoundJson()
}

export const GET = notFound
export const HEAD = notFound
export const POST = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound
export const OPTIONS = notFound
