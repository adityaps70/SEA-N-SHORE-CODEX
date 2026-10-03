'use client'

import type { OwnProfile } from '../types'
import { ProfileGoalsPageForm } from './profile-goals-editor'

/**
 * Profile type & goals on Edit profile (reached from Settings → Profile information). Round 11:
 * the same fields and the same server action as the Profile box in My Profile's "Access & goals",
 * so the two never disagree.
 */
export function ProfilePreferencesForm({ profile }: { profile: OwnProfile }) {
  return (
    <section className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-ocean-700">Sea N Shore identity</p>
      <h2 className="mt-1 text-xl font-bold text-navy-950">Profile type & goals</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        These are the same profile preferences used during onboarding. They personalize Sea N Shore but do not grant paid publishing permissions.
      </p>
      <ProfileGoalsPageForm profile={profile} />
    </section>
  )
}
