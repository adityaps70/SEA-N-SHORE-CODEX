import { notFound } from 'next/navigation'
import { requirePlatformAdministratorUser } from '@/features/admin/access'

/** Page guard for /admin/payments/**: platform administrators only, everyone else gets a 404. */
export async function requirePaymentsAdmin() {
  try {
    return await requirePlatformAdministratorUser()
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') notFound()
    throw error
  }
}
