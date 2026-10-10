import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { getVerifiedUser } from '@/features/auth/queries'

/** The signed-in viewer for session routes (staff checks allow platform admins with MFA), or null when signed out. */
export async function sessionViewer() {
  const user = await getVerifiedUser()
  if (!user) return null
  return { actorId: user.id, allCourses: await canUsePlatformAdminAuthority(user.id) }
}

export const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function sessionTextResponse(message: string, status: number) {
  return new Response(message, { status, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' } })
}
