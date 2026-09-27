import { createMediaReadUrl } from '@/lib/aws/storage'

/**
 * Short-lived signed URL for an applicant's profile photo, as used across Sea N Shore profiles.
 * Returns null when there is no photo or it cannot be signed, so the page shows initials instead.
 */
export async function applicantPhotoUrl(avatarPath: string | null, signUrl: (key: string, seconds: number) => Promise<string> = createMediaReadUrl) {
  if (!avatarPath) return null
  try {
    return await signUrl(avatarPath, 900)
  } catch {
    return null
  }
}
