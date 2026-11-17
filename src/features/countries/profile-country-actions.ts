'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { optionalCountryCodeSchema } from './catalog'
import { profileCountryRepository } from './profile-country-repository'

/** Round GP (Global Partners), Part A: a member saves their own country of residence and nationality. */
export type ProfileCountryActionState = {
  status: 'idle' | 'saved' | 'error'
  message?: string
  fieldErrors?: Partial<Record<'countryOfResidence' | 'nationality', string>>
  revision: number
}

const profileCountriesSchema = z.object({
  countryOfResidence: optionalCountryCodeSchema,
  nationality: optionalCountryCodeSchema,
})

function refresh() {
  revalidatePath('/profile')
  revalidatePath('/profile/edit')
  revalidatePath('/home')
}

export async function saveProfileCountries(previous: ProfileCountryActionState, formData: FormData): Promise<ProfileCountryActionState> {
  const revision = previous.revision + 1
  const parsed = profileCountriesSchema.safeParse({
    countryOfResidence: formData.get('countryOfResidence') ?? undefined,
    nationality: formData.get('nationality') ?? undefined,
  })
  if (!parsed.success) {
    const fieldErrors: ProfileCountryActionState['fieldErrors'] = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]
      if (field === 'countryOfResidence' || field === 'nationality') fieldErrors[field] ??= issue.message
    }
    return { status: 'error', message: 'Choose a country from the list.', fieldErrors, revision }
  }

  let user
  try {
    user = await requireAwsUser()
  } catch {
    return { status: 'error', message: 'Your session may have expired. Sign in again and try saving your country.', revision }
  }

  try {
    // The prompt form sends only the country of residence: keep the nationality already saved.
    const keepNationality = !formData.has('nationality')
    const current = keepNationality ? await profileCountryRepository.getOwnCountries(user.id) : null
    const saved = await profileCountryRepository.saveOwnCountries(user.id, {
      countryOfResidence: parsed.data.countryOfResidence ?? null,
      nationality: keepNationality ? current?.nationality ?? null : parsed.data.nationality ?? null,
    })
    if (!saved) return { status: 'error', message: 'We could not save your country. Please try again.', revision }
  } catch {
    return { status: 'error', message: 'We could not save your country. Please try again.', revision }
  }

  refresh()
  return { status: 'saved', message: 'Country saved.', revision }
}

export async function dismissCountryPrompt(): Promise<void> {
  let user
  try {
    user = await requireAwsUser()
  } catch {
    return
  }
  await profileCountryRepository.dismissPrompt(user.id).catch(() => undefined)
  revalidatePath('/home')
  revalidatePath('/profile')
}
