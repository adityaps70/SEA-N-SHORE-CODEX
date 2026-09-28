'use client'

import Link from 'next/link'
import { FileText, IdCard, MoreHorizontal, Send, UserRound, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { BottomSheet, MobileSheetCancel, SheetRow } from '@/components/ui/mobile-sheet'
import { startDirectConversationAction } from '@/features/messaging/actions'
import { MORE_BUTTON_CLASS } from './mobile-chip'
import { SheetPortal } from './sheet-portal'

const ROW_LINK_CLASS =
  'flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 [&>svg]:size-5 [&>svg]:shrink-0'

/** Phone "…" sheet on the applicant review page: profile, Message, CV, DG profile, all applicants. */
export function ApplicantMoreMenu({
  candidateName,
  profileHref,
  message,
  cvHref,
  dgProfileHref,
  applicantsHref,
}: {
  candidateName: string
  profileHref: string | null
  /** Null when the member can't be messaged at all (inactive account). */
  message: { targetProfileId: string; canMessage: boolean } | null
  cvHref: string | null
  dgProfileHref: string | null
  applicantsHref: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function startMessage() {
    if (!message) return
    setError('')
    startTransition(async () => {
      const result = await startDirectConversationAction(message.targetProfileId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(`/messages/${result.conversationId}`)
    })
  }

  return (
    <>
      <button type="button" aria-label="More applicant actions" aria-haspopup="dialog" onClick={() => setOpen(true)} className={MORE_BUTTON_CLASS}>
        <MoreHorizontal aria-hidden="true" className="size-6" />
      </button>
      <SheetPortal>
        <BottomSheet open={open} onClose={() => setOpen(false)} desktop="hidden">
          <div role="menu" aria-label={`Actions for ${candidateName}`}>
            {profileHref ? (
              <Link role="menuitem" href={profileHref} className={ROW_LINK_CLASS}><UserRound aria-hidden="true" />View Maritime Profile</Link>
            ) : null}
            {message ? (
              <>
                <SheetRow
                  role="menuitem"
                  icon={<Send aria-hidden="true" />}
                  label={pending ? 'Opening…' : 'Message applicant'}
                  hint={message.canMessage ? undefined : 'Connect first'}
                  disabled={!message.canMessage || pending}
                  onClick={startMessage}
                />
                {!message.canMessage ? (
                  <p className="-mt-2 px-4 pb-2 pl-13 text-[13px] text-muted">Connect with {candidateName} to message them. Messages are open to accepted connections only.</p>
                ) : null}
              </>
            ) : null}
            {cvHref ? (
              <a role="menuitem" href={cvHref} target="_blank" rel="noreferrer" className={ROW_LINK_CLASS}><FileText aria-hidden="true" />Open CV (PDF)</a>
            ) : null}
            {dgProfileHref ? (
              <a role="menuitem" href={dgProfileHref} target="_blank" rel="noopener noreferrer" className={ROW_LINK_CLASS}><IdCard aria-hidden="true" />Open DG profile (PDF)</a>
            ) : null}
            <Link role="menuitem" href={applicantsHref} className={ROW_LINK_CLASS}><Users aria-hidden="true" />All applicants</Link>
            {error ? <p role="alert" className="px-4 py-2 text-sm font-medium text-red-700">{error}</p> : null}
          </div>
          <div className="px-2"><MobileSheetCancel onClick={() => setOpen(false)} /></div>
        </BottomSheet>
      </SheetPortal>
    </>
  )
}
