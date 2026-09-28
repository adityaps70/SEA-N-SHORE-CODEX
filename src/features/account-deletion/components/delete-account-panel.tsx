'use client'

import { useState } from 'react'
import { AlertTriangle, Building2, CheckCircle2, LockKeyhole, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { AccountDeletionPlan } from '@/features/account-deletion/plan'
import type { DeletionReauthView } from '@/features/account-deletion/reauth'
import { displayPhoneNumber } from '@/features/auth/phone-link'

type DeleteResponse = {
  ok: boolean
  error?: string
  redirectTo?: string
}

function PlanDetails({ plan }: { plan: AccountDeletionPlan }) {
  return (
    <div className="mt-4 grid gap-3 text-sm leading-6 text-navy-950">
      {plan.warnings.length ? (
        <ul className="grid gap-2" aria-label="Before you delete">
          {plan.warnings.map((warning) => (
            <li key={warning} className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 font-medium text-amber-900">
              <AlertTriangle aria-hidden="true" className="mt-1 size-4 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-labelledby="deletion-deleted-heading" className="rounded-xl border border-mist-100 bg-white p-4">
          <h4 id="deletion-deleted-heading" className="flex items-center gap-2 font-semibold">
            <Trash2 aria-hidden="true" className="size-4 text-red-700" />
            Will be deleted
          </h4>
          <ul className="mt-2 grid list-disc gap-1 pl-5 text-muted">
            {plan.deleted.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
        <section aria-labelledby="deletion-stays-heading" className="rounded-xl border border-mist-100 bg-white p-4">
          <h4 id="deletion-stays-heading" className="flex items-center gap-2 font-semibold">
            <CheckCircle2 aria-hidden="true" className="size-4 text-ocean-700" />
            What happens to other people
          </h4>
          <ul className="mt-2 grid list-disc gap-1 pl-5 text-muted">
            {plan.stays.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
      </div>

      {plan.organizations.length ? (
        <section aria-labelledby="deletion-organizations-heading" className="rounded-xl border border-mist-100 bg-white p-4">
          <h4 id="deletion-organizations-heading" className="flex items-center gap-2 font-semibold">
            <Building2 aria-hidden="true" className="size-4 text-ocean-700" />
            Organizations you manage
          </h4>
          <ul className="mt-2 grid gap-2">
            {plan.organizations.map((organization) => (
              <li key={organization.companyId} className="flex flex-col gap-1 rounded-lg bg-mist-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-semibold">{organization.name}</span>
                <span className={organization.outcome === 'stays' ? 'text-ocean-700' : 'font-medium text-red-700'}>
                  {organization.summary}
                </span>
              </li>
            ))}
          </ul>
          {plan.organizations.some((organization) => organization.outcome === 'page_only') ? (
            <p className="mt-2 text-xs leading-5 text-muted">
              A page you manage alone keeps its name, logo, about and followers, but becomes an unclaimed page without its verified badge until someone who runs the organization claims it. To hand it over instead, make someone else an owner or administrator before you delete your account.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm font-medium text-ink outline-none focus:border-ocean-500'

export function DeleteAccountPanel({
  plan = null,
  reauth = { method: 'password' },
}: { plan?: AccountDeletionPlan | null; reauth?: DeletionReauthView } = {}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const proofReady = reauth.method === 'password'
    ? password.length > 0
    : reauth.method === 'phone_code'
      ? /^\d{6}$/.test(code.trim())
      : reauth.method === 'recent_sign_in' && reauth.fresh
  const canDelete = proofReady && confirmation === 'DELETE' && !pending

  function close() {
    if (pending) return
    setOpen(false)
    setPassword('')
    setCode('')
    setConfirmation('')
    setError(null)
  }

  async function sendCode() {
    if (sending) return
    setSending(true)
    setError(null)
    try {
      const response = await fetch('/api/account/delete/code', { method: 'POST', credentials: 'same-origin' })
      const result = await response.json() as { ok: boolean; message?: string; error?: string }
      if (!response.ok || !result.ok) setError(result.error ?? 'We couldn’t send a code just now. Please try again.')
      else setCodeSent(result.message ?? 'We sent you a 6-digit code.')
    } catch {
      setError('We could not reach Sea N Shore. Check your connection and try again.')
    } finally {
      setSending(false)
    }
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
        body: JSON.stringify(
          reauth.method === 'password'
            ? { password, confirmation }
            : reauth.method === 'phone_code'
              ? { code: code.trim(), confirmation }
              : { confirmation },
        ),
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

          {plan ? <PlanDetails plan={plan} /> : (
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
          )}

          <div className="mt-5 rounded-xl border border-mist-100 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-navy-950">
              <LockKeyhole aria-hidden="true" className="size-4 text-ocean-700" />
              Re-authenticate to continue
            </div>
            {reauth.method === 'password' ? (
              <p className="mt-1 text-xs leading-5 text-muted">
                Enter your current password and type DELETE exactly. We verify your password with the sign-in provider before any account data is removed.
              </p>
            ) : reauth.method === 'phone_code' ? (
              <p className="mt-1 text-xs leading-5 text-muted">
                You sign in with your mobile number, so we text a one-time code to confirm it’s you. Enter it and type DELETE exactly.
              </p>
            ) : reauth.method === 'recent_sign_in' ? (
              <p className="mt-1 text-xs leading-5 text-muted">
                {reauth.fresh
                  ? 'You signed in with Google in the last 10 minutes, so no password is needed. Type DELETE exactly to continue.'
                  : 'You sign in with Google, so for your security you need to have signed in within the last 10 minutes. Sign in with Google again, then come back to Settings.'}
              </p>
            ) : (
              <p className="mt-1 text-xs leading-5 text-muted">
                We can’t confirm it’s you for this sign-in method. Contact info@beaufortmarine.in and we’ll help you delete your account.
              </p>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {reauth.method === 'password' ? (
                <label className="text-sm font-semibold text-navy-950">
                  Current password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={inputClass}
                  />
                </label>
              ) : null}
              {reauth.method === 'phone_code' ? (
                <div className="grid gap-2">
                  <label className="text-sm font-semibold text-navy-950">
                    Code texted to {displayPhoneNumber(reauth.phoneNumber)}
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="123456"
                      className={`${inputClass} tracking-[0.2em]`}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void sendCode()}
                    disabled={sending}
                    className="min-h-11 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50 disabled:opacity-50"
                  >
                    {sending ? 'Sending code…' : codeSent ? 'Send a new code' : 'Text me a code'}
                  </button>
                  {codeSent ? <p role="status" className="text-xs font-medium text-ocean-700">{codeSent}</p> : null}
                </div>
              ) : null}
              {reauth.method === 'recent_sign_in' && !reauth.fresh ? (
                <a
                  href="/auth/google/start"
                  className="inline-flex min-h-11 items-center justify-center self-end rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50"
                >
                  Sign in with Google again
                </a>
              ) : null}
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
                className="min-h-11 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50 disabled:opacity-50"
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
