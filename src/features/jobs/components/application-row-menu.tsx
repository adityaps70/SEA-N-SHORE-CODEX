'use client'

import Link from 'next/link'
import { BriefcaseBusiness, CheckCircle2, ListChecks, MoreHorizontal, Send, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { BottomSheet, MobileSheetCancel, SheetRow } from '@/components/ui/mobile-sheet'
import { startDirectConversationAction } from '@/features/messaging/actions'
import { withdrawJobApplication } from '../actions'
import { JOB_APPLICATION_STATUS_LABELS, type JobApplicationEvent } from '../types'
import { MORE_BUTTON_CLASS, PHONE_OUTLINE_BUTTON } from './mobile-chip'
import { SheetPortal } from './sheet-portal'

export type ApplicationRecruiterContact = {
  profileId: string
  /** Messaging is limited to accepted connections; when false the row explains why. */
  canMessage: boolean
}

const ROW_LINK_CLASS =
  'flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 [&>svg]:size-5 [&>svg]:shrink-0'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

/** Confirmation used by both the phone sheet and the desktop Withdraw button. */
function useWithdraw(applicationId: string) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function withdraw(onDone?: () => void) {
    setError('')
    startTransition(async () => {
      const result = await withdrawJobApplication(applicationId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDone(true)
      onDone?.()
      router.refresh()
    })
  }

  return { pending, error, done, withdraw }
}

/** Phone "…" sheet for one application: View job, Message recruiter, timeline, Withdraw. */
export function ApplicationRowMenu({
  applicationId,
  jobId,
  jobTitle,
  jobOpen,
  canWithdraw,
  recruiter,
  appliedAt,
  events,
  coverNote,
}: {
  applicationId: string
  jobId: string
  jobTitle: string
  jobOpen: boolean
  canWithdraw: boolean
  recruiter: ApplicationRecruiterContact | null
  appliedAt: string
  events: JobApplicationEvent[]
  coverNote: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'menu' | 'timeline' | 'withdraw'>('menu')
  const [messageError, setMessageError] = useState('')
  const [messaging, startMessaging] = useTransition()
  const { pending, error, withdraw } = useWithdraw(applicationId)

  function close() {
    setOpen(false)
    setView('menu')
    setMessageError('')
  }

  function messageRecruiter() {
    if (!recruiter) return
    setMessageError('')
    startMessaging(async () => {
      const result = await startDirectConversationAction(recruiter.profileId)
      if (!result.ok) {
        setMessageError(result.error)
        return
      }
      router.push(`/messages/${result.conversationId}`)
    })
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Actions for ${jobTitle}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`${MORE_BUTTON_CLASS} relative z-10 -mr-2 -mt-2`}
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>
      <SheetPortal>
      <BottomSheet
        open={open}
        onClose={close}
        desktop="hidden"
        title={view === 'timeline' ? 'Application timeline' : view === 'withdraw' ? 'Withdraw application?' : undefined}
      >
        {view === 'menu' ? (
          <div role="menu" aria-label={`Actions for ${jobTitle}`}>
            {jobOpen ? (
              <Link role="menuitem" href={`/jobs/${jobId}`} className={ROW_LINK_CLASS}>
                <BriefcaseBusiness aria-hidden="true" />
                View job
              </Link>
            ) : null}
            {recruiter ? (
              <SheetRow
                role="menuitem"
                icon={<Send aria-hidden="true" />}
                label={messaging ? 'Opening…' : 'Message recruiter'}
                hint={recruiter.canMessage ? undefined : 'Connect first'}
                disabled={!recruiter.canMessage || messaging}
                aria-describedby={recruiter.canMessage ? undefined : `message-reason-${applicationId}`}
                onClick={messageRecruiter}
              />
            ) : null}
            {recruiter && !recruiter.canMessage ? (
              <p id={`message-reason-${applicationId}`} className="-mt-2 px-4 pb-2 pl-13 text-[13px] text-muted">
                You can message accepted connections only.
              </p>
            ) : null}
            <SheetRow role="menuitem" icon={<ListChecks aria-hidden="true" />} label="Application timeline" onClick={() => setView('timeline')} />
            {canWithdraw ? (
              <SheetRow role="menuitem" tone="danger" icon={<XCircle aria-hidden="true" />} label="Withdraw application" onClick={() => setView('withdraw')} />
            ) : null}
            {messageError ? <p role="alert" className="px-4 py-2 text-sm font-medium text-red-700">{messageError}</p> : null}
          </div>
        ) : null}

        {view === 'timeline' ? (
          <div className="px-3 pt-1">
            {coverNote ? (
              <div className="mb-4 rounded-xl bg-mist-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your message to the employer</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{coverNote}</p>
              </div>
            ) : null}
            <ol className="space-y-3">
              {(events.length ? events : [{ id: 'applied', status: 'applied' as const, note: null, createdAt: appliedAt }]).map((event) => (
                <li key={event.id} className="flex gap-3">
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ocean-700" />
                  <div>
                    <p className="text-[15px] font-semibold text-navy-950">{JOB_APPLICATION_STATUS_LABELS[event.status]}</p>
                    <p className="text-[13px] text-muted">{formatDate(event.createdAt)}</p>
                    {event.note ? <p className="mt-1 text-sm leading-6 text-ink">{event.note}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {view === 'withdraw' ? (
          <div className="px-3 pt-1">
            <p className="text-[15px] leading-6 text-ink">
              Your application for <strong className="font-semibold">{jobTitle}</strong> will be withdrawn and the employer will see it as withdrawn. You can’t apply for this job again.
            </p>
            {error ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => withdraw(close)}
                className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full bg-red-700 px-5 text-[15px] font-semibold text-white hover:bg-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-wait disabled:opacity-60"
              >
                {pending ? 'Withdrawing…' : 'Withdraw application'}
              </button>
              <button type="button" disabled={pending} onClick={() => setView('menu')} className={PHONE_OUTLINE_BUTTON}>
                Keep application
              </button>
            </div>
          </div>
        ) : null}

        <div className="px-2">
          <MobileSheetCancel onClick={view === 'menu' ? close : () => setView('menu')} label={view === 'menu' ? 'Cancel' : 'Back'} />
        </div>
      </BottomSheet>
      </SheetPortal>
    </>
  )
}

/** Desktop Withdraw button with an inline confirmation. */
export function WithdrawApplicationButton({ applicationId, jobTitle }: { applicationId: string; jobTitle: string }) {
  const [confirming, setConfirming] = useState(false)
  const { pending, error, done, withdraw } = useWithdraw(applicationId)

  if (done) return <p role="status" className="text-sm font-semibold text-navy-900">Application withdrawn.</p>

  return (
    <div>
      {confirming ? (
        <div role="group" aria-label={`Withdraw your application for ${jobTitle}`} className="rounded-xl border border-red-200 bg-red-50/60 p-3">
          <p className="text-sm leading-6 text-ink">Withdraw your application for <strong className="font-semibold">{jobTitle}</strong>? The employer will see it as withdrawn and you can’t apply again.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => withdraw()} className="inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-wait disabled:opacity-60">
              {pending ? 'Withdrawing…' : 'Withdraw application'}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50">
              Keep application
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50">
          <XCircle aria-hidden="true" className="size-4" />
          Withdraw
        </button>
      )}
      {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
    </div>
  )
}
