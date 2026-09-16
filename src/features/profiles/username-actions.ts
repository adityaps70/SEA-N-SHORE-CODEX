'use server'

import { requireAwsUser } from '@/features/auth/aws-queries'
import { checkUsernameAvailabilityFromAurora } from './username-availability'

export async function checkUsernameAvailability(username: string) {
  const user = await requireAwsUser()
  return checkUsernameAvailabilityFromAurora(user.id, username)
}
