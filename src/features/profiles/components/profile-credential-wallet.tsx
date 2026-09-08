'use client'

import { useActionState, useState, useTransition } from 'react'
import {
  BadgeCheck,
  CalendarDays,
  FileCheck2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import {
  createProfileCredential,
  deleteProfileCredential,
  updateProfileCredential,
  type ProfilePortfolioActionState,
} from '../profile-portfolio-actions'
import type { CredentialVerificationState, ProfileCredentialRecord } from '../profile-portfolio-types'

const initialActionState: ProfilePortfolioActionState = {}

function dateLabel(value: string | null) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function verificationLabel(state: CredentialVerificationState) {
  switch (state) {
    case 'verified':
      return 'Verified'
    case 'pending':
      return 'Verification pending'
    case 'rejected':
      return 'Needs review'
    default:
      return 'Self-reported'
  }
}

function verificationClass(state: CredentialVerificationState) {
  switch (state) {
    case 'verified':
      return 'border-teal-200 bg-teal-50 text-teal-800'
    case 'pending':
      return 'border-amber-200 bg-amber-50 text-amber-800'
    case 'rejected':
      return 'border-red-200 bg-red-50 text-red-700'
    default:
      return 'border-mist-100 bg-mist-50 text-muted'
  }
}

function FieldError({ state, name }: { state: ProfilePortfolioActionState; name: string }) {
  const message = state.fieldErrors?.[name]?.[0]
  return message ? <p className="mt-1 text-xs font-medium text-red-700">{message}</p> : null
}

function CredentialEditor({
  credential,
  onClose,
}: {
  credential?: ProfileCredentialRecord
  onClose: () => void
}) {
  const [noExpiry, setNoExpiry] = useState(credential?.noExpiry ?? false)

  async function submit(previousState: ProfilePortfolioActionState, formData: FormData) {
    const nextState = credential
      ? await updateProfileCredential(credential.id, previousState, formData)
      : await createProfileCredential(previousState, formData)

    if (nextState.success) onClose()
    return nextState
  }

  const [state, formAction, pending] = useActionState(submit, initialActionState)
  const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none transition focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100 disabled:bg-mist-50 disabled:text-muted'
  const labelClass = 'block text-sm font-semibold text-navy-950'

  return (
    <form action={formAction} className="mt-5 rounded-2xl border border-ocean-100 bg-ocean-50/35 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.13em] text-ocean-700">{credential ? 'Edit credential' : 'Add credential'}</p>
          <p className="mt-1 text-sm leading-5 text-muted">
            New credentials are self-reported until Sea N Shore&apos;s evidence review confirms them.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close credential editor" className="grid size-9 shrink-0 place-items-center rounded-full border border-mist-100 bg-white text-muted hover:text-navy-950">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Certificate / CoC name
          <input name="name" maxLength={180} defaultValue={credential?.name ?? ''} className={inputClass} placeholder="Certificate of Competency - Master" />
          <FieldError state={state} name="name" />
        </label>
        <label className={labelClass}>
          Issuing authority
          <input name="issuer" maxLength={180} defaultValue={credential?.issuer ?? ''} className={inputClass} placeholder="DG Shipping India" />
          <FieldError state={state} name="issuer" />
        </label>
        <label className={labelClass}>
          Credential number
          <input name="credentialNumber" maxLength={180} defaultValue={credential?.credentialNumber ?? ''} className={inputClass} />
          <FieldError state={state} name="credentialNumber" />
        </label>
        <label className={labelClass}>
          Issue date
          <input name="issuedOn" type="date" defaultValue={credential?.issuedOn ?? ''} className={inputClass} />
          <FieldError state={state} name="issuedOn" />
        </label>
        <label className={labelClass}>
          Expiry date
          <input name="expiresOn" type="date" defaultValue={credential?.expiresOn ?? ''} disabled={noExpiry} className={inputClass} />
          <FieldError state={state} name="expiresOn" />
        </label>
        <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950">
          <input
            name="noExpiry"
            type="checkbox"
            checked={noExpiry}
            onChange={(event) => setNoExpiry(event.target.checked)}
          />
          This credential does not expire
        </label>
      </div>

      {state.error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-mist-100 bg-white px-4 text-sm font-semibold text-navy-950">Cancel</button>
        <button type="submit" disabled={pending} className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? 'Saving…' : credential ? 'Save credential' : 'Add credential'}
        </button>
      </div>
    </form>
  )
}

function CredentialEntry({
  credential,
  editable,
  onEdit,
}: {
  credential: ProfileCredentialRecord
  editable: boolean
  onEdit: () => void
}) {
  const [deleting, startDelete] = useTransition()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const issued = dateLabel(credential.issuedOn)
  const expiry = credential.noExpiry ? 'No expiry' : dateLabel(credential.expiresOn)

  function remove() {
    setDeleteError(null)
    startDelete(async () => {
      const result = await deleteProfileCredential(credential.id)
      if (!result.success) setDeleteError(result.error ?? 'We could not delete this credential.')
    })
  }

  return (
    <article className="rounded-2xl border border-mist-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${verificationClass(credential.verificationState)}`}>
              {credential.verificationState === 'verified' ? <BadgeCheck aria-hidden="true" className="size-3.5" /> : <ShieldCheck aria-hidden="true" className="size-3.5" />}
              {verificationLabel(credential.verificationState)}
            </span>
          </div>
          <h3 className="mt-3 text-base font-semibold leading-6 text-navy-950 sm:text-lg">{credential.name}</h3>
          <p className="mt-1 text-sm font-medium text-ink">{credential.issuer}</p>
          {credential.credentialNumber ? <p className="mt-1 text-sm text-muted">Credential no. {credential.credentialNumber}</p> : null}
        </div>

        {editable ? (
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={onEdit} aria-label={`Edit ${credential.name}`} className="grid size-9 place-items-center rounded-full border border-mist-100 text-muted hover:border-ocean-400 hover:text-ocean-700">
              <Pencil aria-hidden="true" className="size-4" />
            </button>
            <button type="button" onClick={remove} disabled={deleting} aria-label={`Delete ${credential.name}`} className="grid size-9 place-items-center rounded-full border border-mist-100 text-muted hover:border-red-200 hover:text-red-700 disabled:opacity-50">
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          </div>
        ) : null}
      </div>

      {(issued || expiry) ? (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-mist-100 pt-3 text-sm text-muted">
          {issued ? <span className="inline-flex items-center gap-1.5"><CalendarDays aria-hidden="true" className="size-4" />Issued {issued}</span> : null}
          {expiry ? <span className="inline-flex items-center gap-1.5"><FileCheck2 aria-hidden="true" className="size-4" />{credential.noExpiry ? expiry : `Expires ${expiry}`}</span> : null}
        </div>
      ) : null}

      {deleteError ? <p role="alert" className="mt-3 text-sm font-medium text-red-700">{deleteError}</p> : null}
    </article>
  )
}

export function ProfileCredentialWallet({
  credentials,
  editable = false,
}: {
  credentials: ProfileCredentialRecord[]
  editable?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  if (!editable && credentials.length === 0) return null

  return (
    <Card className="border border-mist-100 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">
            <FileCheck2 aria-hidden="true" className="size-4" />
            CoC & credentials
          </div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-navy-950">Certification wallet</h2>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted">Keep certificates of competency, STCW training and professional credentials visible in one place.</p>
        </div>
        {editable && !adding ? (
          <button type="button" onClick={() => { setAdding(true); setEditingId(null) }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white" aria-label="Add credential">
            <Plus aria-hidden="true" className="size-4" />
            Add credential
          </button>
        ) : null}
      </div>

      {adding ? <CredentialEditor onClose={() => setAdding(false)} /> : null}

      {credentials.length ? (
        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          {credentials.map((credential) => (
            editingId === credential.id ? (
              <div key={credential.id} className="lg:col-span-2">
                <CredentialEditor credential={credential} onClose={() => setEditingId(null)} />
              </div>
            ) : (
              <CredentialEntry
                key={credential.id}
                credential={credential}
                editable={editable}
                onEdit={() => { setEditingId(credential.id); setAdding(false) }}
              />
            )
          ))}
        </div>
      ) : editable && !adding ? (
        <div className="mt-6 rounded-2xl border border-dashed border-mist-100 bg-mist-50/50 p-6 text-center">
          <FileCheck2 aria-hidden="true" className="mx-auto size-7 text-ocean-600" />
          <p className="mt-2 text-sm font-semibold text-navy-950">Add your maritime credentials</p>
          <p className="mt-1 text-sm text-muted">New credentials are self-reported until a formal evidence review confirms them.</p>
        </div>
      ) : null}
    </Card>
  )
}
