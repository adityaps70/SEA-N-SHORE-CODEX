'use client'

import Link from 'next/link'
import { Download, Eye, QrCode, Share2 } from 'lucide-react'

export function ProfilePassportToolbar({ slug }: { slug: string }) {
  async function shareProfile() {
    const path = `/people/${slug}`
    const url = typeof window === 'undefined' ? path : `${window.location.origin}${path}`

    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title: 'Sea N Shore Maritime Passport', url })
      return
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url)
    }
  }

  const secondary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-mist-100 bg-white px-3.5 text-sm font-semibold text-navy-950 transition hover:border-ocean-400 hover:text-ocean-700'

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Profile actions">
      <Link href={`/people/${slug}`} className={secondary}>
        <Eye aria-hidden="true" className="size-4" />
        View public profile
      </Link>
      <button type="button" onClick={shareProfile} className={secondary} aria-label="Share profile">
        <Share2 aria-hidden="true" className="size-4" />
        Share profile
      </button>
      <Link href={`/people/${slug}#passport`} className={secondary} aria-label="Open QR profile">
        <QrCode aria-hidden="true" className="size-4" />
        QR profile
      </Link>
      <Link href="/api/profile/cv" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition hover:bg-ocean-700">
        <Download aria-hidden="true" className="size-4" />
        Download CV
      </Link>
    </div>
  )
}
