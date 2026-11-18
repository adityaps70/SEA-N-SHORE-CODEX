'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { ADMIN_MFA_REQUIRED_MESSAGE, adminActionMfaMissing } from '@/features/admin/mfa-gate'
import { CountryAdminError, countryAdminRepository } from './repository'

/**
 * Round GP (Global Partners), Part C: Admin › Country admins. Platform administrators only (the repository checks the
 * role in SQL, after the admin MFA gate here). A country admin calling these gets "only Sea N Shore administrators".
 */
export type CountryAdminActionState = { status: 'idle' | 'saved' | 'error'; message?: string; revision: number }

const MESSAGES: Record<string, string> = {
  admin_forbidden: 'Only Sea N Shore administrators can manage country admins.',
  member_not_found: 'No active member has that username or email. Check it and try again.',
  member_is_platform_admin: 'That member is already a Sea N Shore administrator and can review every country.',
  countries_invalid: 'Choose between 1 and 50 countries from the list.',
  country_admins_unavailable: 'Country admins are not switched on yet: the database update for them (migrations 0109 and 0110) has not been applied.',
  not_a_country_admin: 'That member is not a country admin.',
}

function failure(error: unknown, revision: number): CountryAdminActionState {
  const code = error instanceof CountryAdminError ? error.message : error instanceof Error ? error.message : ''
  return { status: 'error', message: MESSAGES[code] ?? 'That could not be saved. Please try again.', revision }
}

async function adminUser() {
  try {
    const user = await requireAwsUser()
    if (await adminActionMfaMissing(user.id)) return { error: ADMIN_MFA_REQUIRED_MESSAGE } as const
    return { user } as const
  } catch {
    return { error: 'Your session may have expired. Sign in again.' } as const
  }
}

const countriesSchema = z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).min(1).max(50)

function refresh() {
  revalidatePath('/admin/country-admins')
  revalidatePath('/admin/audit')
}

/** Makes the member with this exact username or email a country admin for the chosen countries. */
export async function grantCountryAdminAction(previous: CountryAdminActionState, formData: FormData): Promise<CountryAdminActionState> {
  const revision = previous.revision + 1
  const identifier = String(formData.get('member') ?? '').trim()
  const countries = countriesSchema.safeParse(formData.getAll('countries').map(String))
  if (!identifier) return { status: 'error', message: 'Enter the member’s username or sign-in email.', revision }
  if (!countries.success) return { status: 'error', message: MESSAGES.countries_invalid, revision }
  const auth = await adminUser()
  if ('error' in auth) return { status: 'error', message: auth.error, revision }
  try {
    const member = await countryAdminRepository.findMember(auth.user.id, identifier)
    if (!member) return { status: 'error', message: MESSAGES.member_not_found, revision }
    if (member.isPlatformAdministrator) return { status: 'error', message: MESSAGES.member_is_platform_admin, revision }
    await countryAdminRepository.grant(auth.user.id, member.id, countries.data)
    refresh()
    return { status: 'saved', message: `${member.fullName} is now a country admin.`, revision }
  } catch (error) {
    return failure(error, revision)
  }
}

/** Changes a country admin's countries. */
export async function updateCountryAdminAction(previous: CountryAdminActionState, formData: FormData): Promise<CountryAdminActionState> {
  const revision = previous.revision + 1
  const profileId = z.string().uuid().safeParse(formData.get('profileId'))
  const countries = countriesSchema.safeParse(formData.getAll('countries').map(String))
  if (!profileId.success) return { status: 'error', message: MESSAGES.not_a_country_admin, revision }
  if (!countries.success) return { status: 'error', message: MESSAGES.countries_invalid, revision }
  const auth = await adminUser()
  if ('error' in auth) return { status: 'error', message: auth.error, revision }
  try {
    if (!await countryAdminRepository.getCountries(profileId.data)) return { status: 'error', message: MESSAGES.not_a_country_admin, revision }
    await countryAdminRepository.grant(auth.user.id, profileId.data, countries.data)
    refresh()
    return { status: 'saved', message: 'Countries saved.', revision }
  } catch (error) {
    return failure(error, revision)
  }
}

/** Ends a member's country admin role. */
export async function removeCountryAdminAction(previous: CountryAdminActionState, formData: FormData): Promise<CountryAdminActionState> {
  const revision = previous.revision + 1
  const profileId = z.string().uuid().safeParse(formData.get('profileId'))
  if (!profileId.success) return { status: 'error', message: MESSAGES.not_a_country_admin, revision }
  const auth = await adminUser()
  if ('error' in auth) return { status: 'error', message: auth.error, revision }
  try {
    await countryAdminRepository.remove(auth.user.id, profileId.data)
    refresh()
    return { status: 'saved', message: 'Country admin removed.', revision }
  } catch (error) {
    return failure(error, revision)
  }
}
