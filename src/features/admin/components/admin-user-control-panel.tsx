'use client'

import { useState } from 'react'
import { RotateCcw, ShieldAlert, Trash2, X } from 'lucide-react'
import type { AdminUserStatus } from '../repository'

type ApiResult = { ok: boolean; error?: string }

export function AdminUserControlPanel({
  profileId,
  status,
  isAdministrator,
}: {
  profileId: string
  status: AdminUserStatus
  isAdministrator: boolean
}) {
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  const validReason = reason.trim().length >= 10
  const deleted = status === 'deletion_requested'

  async function runStatus(action: 'suspend' | 'restore') {
    if (!validReason || pending) return
    setPending(true)
    setMessage(null)
    setIsError(false)
    try {
      const response = await fetch(`/api/admin/users/${profileId}/status`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: reason.trim() }),
      })
      const result = await response.json() as ApiResult
      if (!response.ok || !result.ok) {
        setIsError(true)
        setMessage(result.error ?? 'The account status could not be changed.')
        return
      }
      setMessage(action === 'suspend' ? 'Account suspended.' : 'Account restored.')
      window.location.reload()
    } catch {
      setIsError(true)
      setMessage('Sea N Shore could not complete this account action. Try again.')
    } finally {
      setPending(false)
    }
  }

  async function permanentlyDelete() {
    if (!validReason || confirmation !== 'DELETE' || pending) return
    setPending(true)
    setMessage(null)
    setIsError(false)
    try {
      const response = await fetch(`/api/admin/users/${profileId}/delete`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation,
          reason: reason.trim(),
        }),
      })
      const result = await response.json() as ApiResult
      if (!response.ok || !result.ok) {
        setIsError(true)
        setMessage(result.error ?? 'The account could not be permanently deleted.')
        return
      }
      setMessage('Account permanently deleted.')
      window.location.reload()
    } catch {
      setIsError(true)
      setMessage('Sea N Shore could not complete permanent deletion. Try again.')
    } finally {
      setPending(false)
    }
  }

  if (isAdministrator) {
    return (
      <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 sm:p-6">
        <div className="flex gap-3">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
          <div>
            <h2 className="text-lg font-bold text-amber-950">Protected administrator account</h2>
            <p className="mt-1 text-sm leading-6 text-amber-900">
              Administrator accounts are protected from suspension and permanent deletion in this console. Use a separate privileged access-change process.
            </p>
          </div>
        </div>
      </section>
    )
  }

  if (deleted) {
    return (
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <h2 className="text-lg font-bold text-navy-950">Account controls</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          This account has already been permanently deleted and cannot be restored from the admin console.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-red-700">Account control</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">
          {status === 'suspended' ? 'Restore or permanently delete' : 'Suspend or permanently delete'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Every action requires a reason and is written to the audit trail. Suspension blocks authenticated access immediately.
        </p>
      </div>

      <label className="mt-5 block text-sm font-semibold text-navy-950">
        Moderation reason
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={2000}
          placeholder="Record the evidence, policy concern, appeal outcome, or reason for permanent deletion."
          className="mt-2 min-h-28 w-full rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100"
        />
        <span className="mt-1 block text-xs font-normal text-muted">Minimum 10 characters. This reason is visible in admin history.</span>
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        {status === 'suspended' ? (
          <button
            type="button"
            disabled={!validReason || pending}
            onClick={() => void runStatus('restore')}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {pending ? 'Saving…' : 'Restore account'}
          </button>
        ) : (
          <button
            type="button"
            disabled={!validReason || pending}
            onClick={() => void runStatus('suspend')}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-100 px-4 text-sm font-bold text-amber-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShieldAlert aria-hidden="true" className="size-4" />
            {pending ? 'Saving…' : 'Suspend account'}
          </button>
        )}

        <button
          type="button"
          disabled={!validReason || pending}
          onClick={() => {
            setConfirmation('')
            setDeleteOpen(true)
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-800 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          Permanently delete account
        </button>
      </div>

      {message ? (
        <p role="status" className={`mt-4 rounded-xl px-3 py-2 text-sm font-semibold ${isError ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {message}
        </p>
      ) : null}

      {deleteOpen ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50/70 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-red-950">Permanent deletion cannot be undone</h3>
              <p className="mt-1 text-sm leading-6 text-red-900">
                Sea N Shore will remove the sign-in identity, purge or anonymize associated account data, and preserve only integrity records that must remain without a usable member identity.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close permanent deletion"
              onClick={() => setDeleteOpen(false)}
              disabled={pending}
              className="grid size-9 shrink-0 place-items-center rounded-full text-red-800 hover:bg-white"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          <label className="mt-4 block text-sm font-semibold text-red-950">
            Type DELETE to confirm
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="DELETE"
              className="mt-2 min-h-11 w-full rounded-xl border border-red-200 bg-white px-3 text-sm font-bold tracking-[0.08em] text-red-950 outline-none focus:border-red-500"
            />
          </label>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={confirmation !== 'DELETE' || !validReason || pending}
              onClick={() => void permanentlyDelete()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-bold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-200"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {pending ? 'Deleting…' : 'Confirm permanent deletion'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
