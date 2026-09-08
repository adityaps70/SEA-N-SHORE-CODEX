'use client'

import Link from 'next/link'
import { Download, Eye } from 'lucide-react'
import { ProfileShareControls } from './profile-share-controls'

export function ProfilePassportToolbar({ slug, siteUrl }: { slug: string; siteUrl?: string }) {
  const secondary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-mist-100 bg-white px-3.5 text-sm font-semibold text-navy-950 transition hover:border-ocean-400 hover:text-ocean-700'

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Profile actions">
      <Link href={`/people/${slug}`} className={secondary}>
        <Eye aria-hidden="true" className="size-4" />
        View public profile
      </Link>
      <ProfileShareControls slug={slug} siteUrl={siteUrl} />
      <Link href="/api/profile/cv" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition hover:bg-ocean-700">
        <Download aria-hidden="true" className="size-4" />
        Download CV
      </Link>
    </div>
  )
}
