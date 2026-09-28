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
import { DgProfileUpload } from './dg-profile-upload'

/** The owner's DG Shipping profile section on My Profile: add, view, replace or remove. */
export function ProfileDgDocumentCard({
  profileId,
  document,
}: {
  profileId: string
  document: ProfileDocumentSummary | null
}) {
  return (
    <Card className="border border-mist-100 p-5 sm:p-6">
      <section aria-labelledby="dg-profile-card-heading">
        <p className="text-xs font-semibold uppercase tracking-wide text-ocean-700">Private document</p>
        <h2 id="dg-profile-card-heading" className="mt-1 text-lg font-bold text-navy-950">DG Shipping profile</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{DG_PROFILE_EXPLANATION}</p>
        <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-muted">
          <Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          {DG_PROFILE_VISIBILITY}
        </p>
        <div className="mt-4">
          <DgProfileUpload profileId={profileId} initialDocument={document} variant="profile" />
        </div>
      </section>
    </Card>
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
    <Card className="border border-mist-100 p-5 sm:p-6">
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
