import { profileCountryRepository } from '../profile-country-repository'
import { CountryPrompt } from './country-prompt'
import { ProfileCountryForm } from './profile-country-form'

/**
 * Round GP: the member's own country on Home (the one-time prompt) and on Edit profile. A failed read shows nothing
 * on Home and an empty form on Edit profile: neither page waits on or breaks over it.
 */
export async function HomeCountryPrompt({ profileId, className }: { profileId: string; className?: string }) {
  const countries = await profileCountryRepository.getOwnCountries(profileId).catch(() => null)
  if (!countries?.showPrompt) return null
  return (
    <div className={className}>
      <CountryPrompt />
    </div>
  )
}

export async function ProfileCountrySection({ profileId }: { profileId: string }) {
  const countries = await profileCountryRepository.getOwnCountries(profileId).catch(() => null)
  return <ProfileCountryForm countryOfResidence={countries?.countryOfResidence ?? null} nationality={countries?.nationality ?? null} />
}
