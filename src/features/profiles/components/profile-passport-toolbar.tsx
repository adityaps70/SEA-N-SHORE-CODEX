'use client'

import Link from 'next/link'
import { useContext, useState } from 'react'
import { Download, Ellipsis, Eye, Pencil } from 'lucide-react'
import { BottomSheet, SheetRow } from '@/components/ui/mobile-sheet'
import { ProfileIdentityEditorContext } from './profile-header'
import { ProfileShareControls } from './profile-share-controls'

/** Link rows styled like the shared SheetRow (56px, icon + label). */
const sheetLinkRowClass = 'flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 [&>svg]:size-5 [&>svg]:shrink-0'

/**
 * Owner actions under the profile header.
 * Desktop: View public profile · Share profile · QR profile · Download CV (unchanged).
 * Phones: Share · QR · "…" — the "…" sheet holds View public profile, Download CV and Edit profile,
 * which opens the header card's in-place editor (round 11; it never leaves for /profile/edit).
 */
export function ProfilePassportToolbar({ slug, siteUrl }: { slug: string; siteUrl?: string }) {
  const secondary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-3.5 text-sm font-semibold text-navy-950 transition hover:border-ocean-400 hover:bg-mist-50 hover:text-ocean-700'
  const [sheetOpen, setSheetOpen] = useState(false)
  const openIdentityEditor = useContext(ProfileIdentityEditorContext)

  return (
    <div className="flex flex-wrap items-center gap-2 max-md:flex-nowrap" aria-label="Profile actions">
      <Link href={`/people/${slug}`} className={`${secondary} max-md:hidden`}>
        <Eye aria-hidden="true" className="size-4" />
        View public profile
      </Link>
      <ProfileShareControls slug={slug} siteUrl={siteUrl} />
      <Link href="/api/profile/cv" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition hover:bg-ocean-700 max-md:hidden">
        <Download aria-hidden="true" className="size-4" />
        Download CV
      </Link>
      <button
        type="button"
        aria-label="More profile actions"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen(true)}
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-ocean-700 text-ocean-700 hover:bg-ocean-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 md:hidden"
      >
        <Ellipsis aria-hidden="true" className="size-5" />
      </button>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Profile" desktop="hidden">
        <div role="menu" aria-label="More profile actions" className="grid">
          <Link role="menuitem" href={`/people/${slug}`} className={sheetLinkRowClass} onClick={() => setSheetOpen(false)}>
            <Eye aria-hidden="true" />
            View public profile
          </Link>
          <Link role="menuitem" href="/api/profile/cv" className={sheetLinkRowClass} onClick={() => setSheetOpen(false)}>
            <Download aria-hidden="true" />
            Download CV
          </Link>
          {openIdentityEditor ? (
            <SheetRow
              role="menuitem"
              icon={<Pencil aria-hidden="true" />}
              label={(
                <>
                  <span className="block">Edit profile</span>
                  <span className="block text-xs font-medium text-muted">Profile type, name, username, headline, organization, contact visibility</span>
                </>
              )}
              onClick={() => {
                setSheetOpen(false)
                openIdentityEditor()
              }}
            />
          ) : null}
        </div>
      </BottomSheet>
    </div>
  )
}
