'use client'

import { useState } from 'react'
import { AlertTriangle, LockKeyhole, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

type DeleteResponse = {
  ok: boolean
  error?: string
  redirectTo?: string
}

export function DeleteAccountPanel() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canDelete = password.length > 0 && confirmation === 'DELETE' && !pending

  function close() {
    if (pending) return
    setOpen(false)
    setPassword('')
    setConfirmation('')
    setError(null)
  }

  async function submit() {
    if (!canDelete) return
    setPending(true)
    setError(null)

    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirmation }),
      })
      const result = await response.json() as DeleteResponse

      if (!response.ok || !result.ok) {
        setError(result.error ?? 'We could not delete your account safely. Please try again.')
        return
      }

      router.replace(result.redirectTo ?? '/account-deleted')
    } catch {
      setError('We could not reach Sea N Shore. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="rounded-2xl border border-red-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-700">Danger zone</p>
          <h2 className="mt-1 text-xl font-semibold text-navy-950">Delete my account</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Permanently remove your Sea N Shore account and personal profile. This cannot be undone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-100"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          Delete my account
        </button>
      </div>

      {open ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50/60 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-red-100 text-red-700">
                <AlertTriangle aria-hidden="true" className="size-4.5" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-navy-950">Review what happens before you continue</h3>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Account deletion is permanent. We use deletion where it is safe and anonymization where records must remain connected for other members or platform integrity.
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close account deletion"
              onClick={close}
              disabled={pending}
              className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-white hover:text-navy-950 disabled:opacity-40"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          <div className="mt-4 grid gap-3 text-sm leading-6 text-navy-950 sm:grid-cols-2">
            <div className="rounded-xl border border-mist-100 bg-white p-4">
              <p className="font-semibold">Deleted</p>
              <p className="mt-1 text-muted">
                Your profile details, posts, comments, applications, connections, follows, saved activity, job alerts, learner enrollments, progress, attempts, certificates, and private profile data are removed.
              </p>
            </div>
            <div className="rounded-xl border border-mist-100 bg-white p-4">
              <p className="font-semibold">Messages</p>
              <p className="mt-1 text-muted">
                Messages you sent are removed from active conversation history, including their attachments. Conversation structure may remain so another member’s own messages are not broken.
              </p>
            </div>
            <div className="rounded-xl border border-mist-100 bg-white p-4">
              <p className="font-semibold">Learning content</p>
              <p className="mt-1 text-muted">
                Published learning content and course records may be retained in anonymized form so other learners’ access and records are not broken. Your identity is removed from them.
              </p>
            </div>
            <div className="rounded-xl border border-mist-100 bg-white p-4">
              <p className="font-semibold">Safety and audit records</p>
              <p className="mt-1 text-muted">
                Audit and safety records that must remain for integrity may be retained in anonymized form. Your public profile becomes “Deleted member” and cannot be discovered or signed into.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-mist-100 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-navy-950">
              <LockKeyhole aria-hidden="true" className="size-4 text-ocean-700" />
              Re-authenticate to continue
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              Enter your current password and type DELETE exactly. We verify your password with the sign-in provider before any account data is removed.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-navy-950">
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm font-medium text-ink outline-none focus:border-ocean-500"
                />
              </label>
              <label className="text-sm font-semibold text-navy-950">
                Type DELETE to confirm
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="DELETE"
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm font-semibold tracking-[0.08em] text-ink outline-none focus:border-red-400"
                />
              </label>
            </div>

            {error ? (
              <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="min-h-11 rounded-xl border border-mist-100 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canDelete}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-mist-100 disabled:text-muted"
              >
                <Trash2 aria-hidden="true" className="size-4" />
                {pending ? 'Deleting account…' : 'Permanently delete account'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
