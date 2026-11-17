'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { ADMIN_MFA_REQUIRED_MESSAGE, adminActionMfaMissing } from '@/features/admin/mfa-gate'
import { adminRepository } from '@/features/admin/repository'
import { optionalCountryCodeSchema } from './catalog'
import { adminCountryRepository } from './admin-country-repository'

/** Round GP (Global Partners), Part A: a platform administrator sets an organization's country. */
export type AdminCountryActionState = { status: 'idle' | 'saved' | 'error'; message?: string; revision: number }

const setCountrySchema = z.object({
  companyId: z.string().uuid(),
  country: optionalCountryCodeSchema,
})

export async function setOrganizationCountryAction(previous: AdminCountryActionState, formData: FormData): Promise<AdminCountryActionState> {
  const revision = previous.revision + 1
  const parsed = setCountrySchema.safeParse({ companyId: formData.get('companyId'), country: formData.get('country') ?? undefined })
  if (!parsed.success) return { status: 'error', message: 'Choose a country from the list.', revision }

  let user
  try {
    user = await requireAwsUser()
  } catch {
    return { status: 'error', message: 'Your session may have expired. Sign in again.', revision }
  }
  if (await adminActionMfaMissing(user.id)) return { status: 'error', message: ADMIN_MFA_REQUIRED_MESSAGE, revision }

  try {
    const saved = await adminRepository.setOrganizationCountry(user.id, parsed.data.companyId, parsed.data.country ?? null)
    if (!saved) return { status: 'error', message: 'That organization no longer exists.', revision }
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') return { status: 'error', message: 'Only Sea N Shore administrators can set an organization’s country.', revision }
    return { status: 'error', message: 'We could not save the country. Please try again.', revision }
  }

  adminCountryRepository.clearCaches()
  revalidatePath('/admin/organizations')
  revalidatePath('/admin/countries')
  return { status: 'saved', message: 'Country saved.', revision }
}
