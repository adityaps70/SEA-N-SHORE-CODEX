import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { revalidateCategoryPages } from '@/features/community/category-revalidate'
import { CommunityCategoryError, communityCategoryRepository } from '@/features/community/category-repository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Round I (I2): Admin › Communities › Categories over JSON. GET lists the categories in admin order with how many
 * communities use each; PUT { order: [...ids] } saves a new order (drag and drop). Platform administrators only.
 */
const orderSchema = z.object({ order: z.array(z.string().uuid()).min(1).max(500) })

function json(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

async function requireAdmin() {
  try {
    return { admin: await requirePlatformAdministratorUser(), response: null }
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) return { admin: null, response: json({ ok: false, error: 'Sign in again to continue.' }, 401) }
    if (error instanceof Error && error.message === 'admin_forbidden') return { admin: null, response: json({ ok: false, error: 'Administrator access is required.' }, 403) }
    throw error
  }
}

export async function GET() {
  const { admin, response } = await requireAdmin()
  if (!admin) return response
  return json({ ok: true, categories: await communityCategoryRepository.listAll() })
}

export async function PUT(request: Request) {
  const { admin, response } = await requireAdmin()
  if (!admin) return response
  const parsed = orderSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ ok: false, error: 'Send the full order of category ids.' }, 400)
  try {
    await communityCategoryRepository.reorder(admin.id, parsed.data.order)
  } catch (error) {
    if (error instanceof CommunityCategoryError) return json({ ok: false, error: 'The order must list every category once.' }, 409)
    throw error
  }
  revalidateCategoryPages()
  return json({ ok: true, categories: await communityCategoryRepository.listAll() })
}
