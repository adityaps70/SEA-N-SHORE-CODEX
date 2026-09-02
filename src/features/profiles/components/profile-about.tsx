import { Card } from '@/components/ui/card'
import type { PublicProfile } from '../types'

export function ProfileAbout({ profile }: { profile: PublicProfile }) {
  if (!profile.summary && profile.skills.length === 0) return null

  return (
    <Card className="border border-mist-100 p-5 sm:p-7">
      <h2 className="text-xl font-semibold tracking-tight text-navy-950">About</h2>
      {profile.summary ? (
        <p className="mt-3 whitespace-pre-line leading-7 text-muted">{profile.summary}</p>
      ) : null}
      {profile.skills.length ? (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Expertise</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.skills.map((skill) => (
              <span key={skill} className="rounded-full bg-mist-50 px-3 py-1.5 text-sm font-medium text-navy-900">
                {skill}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  )
}
