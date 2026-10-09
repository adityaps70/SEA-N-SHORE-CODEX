'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { certificateRepository } from './certificate-repository'

/** Shows or hides one of the member's own Sea N Shore certificates on their public profile (shown by default). */
export async function setCertificateHiddenFromProfile(certificateId: string, hidden: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(certificateId).success || typeof hidden !== 'boolean') return { ok: false, error: 'Invalid certificate.' }
  try {
    const user = await requireAwsUser()
    await certificateRepository.setHiddenFromProfile(user.id, certificateId, hidden)
    revalidatePath('/profile')
    revalidatePath('/people/[slug]', 'page')
    return { ok: true }
  } catch {
    return { ok: false, error: 'We could not update this certificate. Please try again.' }
  }
}
