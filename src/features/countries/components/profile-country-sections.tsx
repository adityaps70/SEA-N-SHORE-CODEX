import { profileCountryRepository } from '../profile-country-repository'
import { CountryPrompt } from './country-prompt'
import { ProfileCountryForm } from './profile-country-form'

/**
 * Round GP: the member's own country on Home (the one-time prompt) and on Edit profile. A failed read (or a database
 * without migration 0108) shows nothing on either page: neither waits on or breaks over it.
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
  // Nothing to show before migration 0108 (or if the read failed): the rest of Edit profile works as before.
  if (!countries) return null
  return <ProfileCountryForm countryOfResidence={countries.countryOfResidence} nationality={countries.nationality} />
}
