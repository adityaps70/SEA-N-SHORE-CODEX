import { redirect } from 'next/navigation'
import { ProfileEditForm } from '@/features/profiles/components/profile-edit-form'
import { ProfilePreferencesForm } from '@/features/profiles/components/profile-preferences-form'
import { getOwnProfile } from '@/features/profiles/queries'

export default async function EditProfilePage() {
  const profile = await getOwnProfile()
  if (!profile) redirect('/onboarding')

  return (
    <section className="grid gap-5 py-2 sm:py-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[.14em] text-ocean-700">Your Sea N Shore identity</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy-950">Edit profile & goals</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Keep your persona, goals and profile details current. Publishing permissions are managed separately through verification, plan access and organization roles.
        </p>
      </div>

      <ProfilePreferencesForm profile={profile} />
      <ProfileEditForm profile={profile} />
    </section>
  )
}
