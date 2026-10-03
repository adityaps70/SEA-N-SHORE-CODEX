import { requireAwsUser, type AwsVerifiedUser } from '@/features/auth/aws-queries'
import { adminRepository } from './repository'

export async function canAccessPlatformAdmin(userId: string): Promise<boolean> {
  try {
    return await adminRepository.isPlatformAdministrator(userId)
  } catch {
    return false
  }
}

export async function requirePlatformAdministratorUser(): Promise<AwsVerifiedUser> {
  const user = await requireAwsUser()
  const allowed = await adminRepository.isPlatformAdministrator(user.id)
  if (!allowed) throw new Error('admin_forbidden')
  return user
}
