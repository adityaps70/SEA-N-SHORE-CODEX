'use client'

import { Check, CircleCheck, Eye, MessagesSquare, MoreHorizontal, X } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { BottomSheet, MobileSheetCancel, SheetRow } from '@/components/ui/mobile-sheet'
import { HIRING_APPLICATION_STATUS_LABELS, type OwnerSettableApplicationStatus } from '../application-status'
import type { JobApplicationStatus } from '../types'
import { useHiringStatusChange } from './hiring-status-action'
import { MORE_BUTTON_CLASS, PHONE_OUTLINE_BUTTON, PHONE_PRIMARY_BUTTON } from './mobile-chip'
import { SheetPortal } from './sheet-portal'

const MORE_ACTIONS: Array<{ status: OwnerSettableApplicationStatus; label: string; icon: ReactNode }> = [
  { status: 'under_review', label: 'Mark reviewed', icon: <Eye aria-hidden="true" /> },
  { status: 'interview', label: 'Interview', icon: <MessagesSquare aria-hidden="true" /> },
  { status: 'selected', label: 'Hire', icon: <CircleCheck aria-hidden="true" /> },
]

const ACTION_LABEL: Record<OwnerSettableApplicationStatus, string> = {
  under_review: 'Mark reviewed',
  shortlisted: 'Shortlist',
  interview: 'Move to interview',
  selected: 'Hire',
  rejected: 'Reject',
}

/**
 * Phone sticky decision bar on the applicant review page (round 8): Reject · "…" (Reviewed,
 * Interview, Hire) · Shortlist. Every action goes through a confirmation sheet with the optional
 * message to the applicant, using the same status logic as the desktop status card.
 */
export function HiringStatusMobileBar({
  applicationId,
  currentStatus,
  candidateName,
}: {
  applicationId: string
  currentStatus: JobApplicationStatus
  candidateName: string
}) {
  const noteId = useId()
  const { note, setNote, error, success, pending, changeStatus, reset } = useHiringStatusChange(applicationId)
  const [sheet, setSheet] = useState<'closed' | 'more' | OwnerSettableApplicationStatus>('closed')

  function close() {
    if (pending) return
    setSheet('closed')
    reset()
  }

  function choose(status: OwnerSettableApplicationStatus) {
    reset()
    setSheet(status)
  }

  const confirming = sheet !== 'closed' && sheet !== 'more' ? sheet : null

  return (
    <div
      className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-4 border-t border-mist-100 bg-white px-4 py-3 shadow-[0_-8px_24px_rgb(7_27_45/0.08)] md:hidden"
      data-testid="applicant-decision-bar"
    >
      {success ? <p role="status" className="mb-2 text-[13px] font-semibold text-ocean-800">{success}</p> : null}
      {currentStatus === 'withdrawn' ? (
        <p className="text-sm font-semibold text-navy-900">The applicant withdrew this application, so its status can no longer be changed.</p>
      ) : (
        <div role="group" aria-label={`Decide on ${candidateName}`} className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending || currentStatus === 'rejected'}
            onClick={() => choose('rejected')}
            className={`${PHONE_OUTLINE_BUTTON} px-4`}
          >
            <X aria-hidden="true" className="size-4" />
            {currentStatus === 'rejected' ? 'Rejected' : 'Reject'}
          </button>
          <button
            type="button"
            aria-label="More status options"
            aria-haspopup="dialog"
            disabled={pending}
            onClick={() => {
              reset()
              setSheet('more')
            }}
            className={`${MORE_BUTTON_CLASS} border border-ocean-700 bg-white disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <MoreHorizontal aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            disabled={pending || currentStatus === 'shortlisted'}
            onClick={() => choose('shortlisted')}
            className={`${PHONE_PRIMARY_BUTTON} flex-1`}
          >
            <Check aria-hidden="true" className="size-4" />
            {currentStatus === 'shortlisted' ? 'Shortlisted' : 'Shortlist'}
          </button>
        </div>
      )}

      <SheetPortal>
      <BottomSheet
        open={sheet !== 'closed'}
        onClose={close}
        desktop="hidden"
        title={confirming ? `${ACTION_LABEL[confirming]}?` : undefined}
      >
        {sheet === 'more' ? (
          <div role="menu" aria-label="More status options">
            {MORE_ACTIONS.map((action) => (
              <SheetRow
                key={action.status}
                role="menuitem"
                icon={action.icon}
                label={action.label}
                hint={currentStatus === action.status ? 'Current' : undefined}
                disabled={currentStatus === action.status}
                onClick={() => choose(action.status)}
              />
            ))}
          </div>
        ) : null}

        {confirming ? (
          <div className="px-3 pt-1">
            <p className="text-[15px] leading-6 text-ink">
              {candidateName} will move to <strong className="font-semibold">{HIRING_APPLICATION_STATUS_LABELS[confirming]}</strong>. They can see this on their application timeline.
            </p>
            <label htmlFor={noteId} className="mt-4 block text-sm font-bold text-navy-950">
              Message to the applicant <span className="font-medium text-muted">(optional)</span>
            </label>
            <textarea
              id={noteId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="For example: interview timing or next steps."
              className="mt-2 w-full rounded-xl border border-mist-300 bg-white px-3 py-2.5 text-[15px] text-navy-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
            />
            {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
            <button
              type="button"
              disabled={pending}
              onClick={() => changeStatus(confirming, () => setSheet('closed'))}
              className={`${confirming === 'rejected'
                ? 'inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full bg-red-700 px-5 text-[15px] font-semibold text-white hover:bg-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-wait disabled:opacity-60'
                : PHONE_PRIMARY_BUTTON} mt-4 w-full`}
            >
              {pending ? 'Saving…' : ACTION_LABEL[confirming]}
            </button>
          </div>
        ) : null}

        <div className="px-2">
          <MobileSheetCancel onClick={close} />
        </div>
      </BottomSheet>
      </SheetPortal>
    </div>
  )
}
