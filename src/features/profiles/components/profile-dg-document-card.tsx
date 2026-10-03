'use client'

import { useEffect, useRef } from 'react'
import { ExternalLink, FileText, Lock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import {
  DG_PROFILE_EXPLANATION,
  DG_PROFILE_VISIBILITY,
  dgProfileDownloadHref,
  formatDocumentSize,
  type ProfileDocumentSummary,
} from '../profile-document-policy'
import type { DgProfileAccessReason } from '../profile-document-service'
import { firstNameOf } from '../display-name'
import { DgProfileOnFileBadge, DgProfileUpload } from './dg-profile-upload'
import { useProfileCardEditor } from './profile-card-editing'
import { PROFILE_SECTION_PHONE_CLASS, ProfileSection, ProfileSectionEditButton } from './profile-section'

/** The DG profile card's edit mode: add, replace or remove the PDF in place, then Done. */
function DgDocumentEditor({ profileId, document, onClose }: { profileId: string; document: ProfileDocumentSummary | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' })
    ref.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label="Edit DG Shipping profile"
      data-profile-card-form="profile-dg-document"
      className="mt-4 outline-none"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        onClose()
      }}
    >
      <DgProfileUpload profileId={profileId} initialDocument={document} variant="profile" />
      <div className="mt-4 flex justify-end max-md:sticky max-md:bottom-0 max-md:bg-white/95 max-md:py-3 group-has-[[data-phone-tabbar=on]]/shell:max-md:bottom-[calc(4.5rem+env(safe-area-inset-bottom))]">
        <button type="button" onClick={onClose} className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-navy-800">
          Done
        </button>
      </div>
    </div>
  )
}

/** The owner's DG Shipping profile section on My Profile: its pencil adds, replaces or removes the PDF in place. */
export function ProfileDgDocumentCard({
  profileId,
  document,
}: {
  profileId: string
  document: ProfileDocumentSummary | null
}) {
  const editor = useProfileCardEditor('profile-dg-document', 'DG Shipping profile')

  return (
    <ProfileSection
      id="profile-dg-document"
      title="DG Shipping profile"
      description={DG_PROFILE_EXPLANATION}
      action={editor.editing ? null : <ProfileSectionEditButton label="Edit DG Shipping profile" onClick={editor.open} buttonRef={editor.triggerRef} />}
    >
      <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-muted">
        <Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
        {DG_PROFILE_VISIBILITY}
      </p>
      {editor.editing ? (
        <DgDocumentEditor profileId={profileId} document={document} onClose={editor.close} />
      ) : document ? (
        <div className="mt-4 flex min-w-0 items-start gap-3 rounded-2xl border border-mist-100 bg-white p-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist-50 text-ocean-700">
            <FileText aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <DgProfileOnFileBadge />
            <p className="mt-2 text-sm font-semibold text-navy-950 [overflow-wrap:anywhere]">{document.fileName}</p>
            <p className="mt-0.5 text-xs text-muted">{formatDocumentSize(document.sizeBytes)} · PDF</p>
            <a href={dgProfileDownloadHref(profileId)} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-ocean-700 hover:underline">
              View PDF
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">No DG profile yet. Use the pencil to add your DG Shipping profile PDF (PDF only, up to 10 MB).</p>
      )}
    </ProfileSection>
  )
}

/** Shown on someone else's profile only to an administrator or a hiring reviewer for a job they applied to. */
export function ProfileDgDocumentViewerCard({
  profileId,
  fullName,
  document,
  reason,
}: {
  profileId: string
  fullName: string
  document: ProfileDocumentSummary
  reason: Exclude<DgProfileAccessReason, 'owner'>
}) {
  const why = reason === 'admin'
    ? 'You can open this because you are a Sea N Shore administrator.'
    : `You can open this because ${firstNameOf(fullName, 'this member')} applied to a job you manage.`

  return (
    <Card className={`border border-mist-100 p-5 sm:p-6 ${PROFILE_SECTION_PHONE_CLASS}`}>
      <section aria-labelledby="dg-profile-viewer-heading">
        <p className="text-xs font-semibold uppercase tracking-wide text-ocean-700">Private document</p>
        <h2 id="dg-profile-viewer-heading" className="mt-1 text-lg font-bold text-navy-950">DG Shipping profile</h2>
        <div className="mt-4 flex min-w-0 items-start gap-3 rounded-2xl border border-mist-100 bg-mist-50 p-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-ocean-700 shadow-sm">
            <FileText aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-navy-950 [overflow-wrap:anywhere]">{document.fileName}</p>
            <p className="mt-0.5 text-xs text-muted">{formatDocumentSize(document.sizeBytes)} · PDF</p>
          </div>
        </div>
        <a
          href={dgProfileDownloadHref(profileId)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-ocean-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 sm:w-auto"
        >
          Open DG profile (PDF)
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted">
          <Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          {why} Do not share this document outside your hiring process.
        </p>
      </section>
    </Card>
  )
}
