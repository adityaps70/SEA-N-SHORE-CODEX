'use client'

import { useActionState, useState, useTransition } from 'react'
import {
  BadgeCheck,
  CalendarDays,
  FileCheck2,
  Pencil,
  Plus,
  ShieldCheck,
} from 'lucide-react'
import type { Persona } from '../persona'
import {
  createProfileCredential,
  deleteProfileCredential,
  updateProfileCredential,
  type ProfilePortfolioActionState,
} from '../profile-portfolio-actions'
import { personaUsesCredentials } from '../profile-persona-rules'
import type { CredentialVerificationState, ProfileCredentialRecord } from '../profile-portfolio-types'
import { ProfileCardFieldError, ProfileCardForm, profileCardLabelClass, useProfileCardEditor } from './profile-card-editing'
import { PHONE_ICON_ADD_BUTTON_CLASS, ProfileSection } from './profile-section'
import { PhoneShowAll } from './profile-show-all'

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

const itemPencilClass = 'grid size-9 shrink-0 place-items-center rounded-full border border-mist-200 text-muted transition-colors hover:border-ocean-400 hover:text-ocean-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600 max-md:size-11 max-md:border-transparent'

/** One credential's in-place form (add or edit); editing also offers Delete, confirmed in place. */
function CredentialEditor({
  cardId,
  credential,
  onClose,
  onDirty,
}: {
  cardId: string
  credential?: ProfileCredentialRecord
  onClose: () => void
  onDirty: () => void
}) {
  const [noExpiry, setNoExpiry] = useState(credential?.noExpiry ?? false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, startDelete] = useTransition()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function submit(previousState: ProfilePortfolioActionState, formData: FormData) {
    const nextState = credential
      ? await updateProfileCredential(credential.id, previousState, formData)
      : await createProfileCredential(previousState, formData)

    if (nextState.success) onClose()
    return nextState
  }

  function remove() {
    if (!credential) return
    setDeleteError(null)
    startDelete(async () => {
      const result = await deleteProfileCredential(credential.id)
      if (result.success) onClose()
      else setDeleteError(result.error ?? 'We could not delete this credential.')
    })
  }

  const [state, formAction, pending] = useActionState(submit, initialActionState)
  const busy = pending || deleting
  const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none transition focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100 disabled:bg-mist-50 disabled:text-muted'
  const labelClass = profileCardLabelClass
  const errors = state.fieldErrors

  return (
    <ProfileCardForm
      cardId={cardId}
      label={credential ? `Edit ${credential.name}` : 'Add credential'}
      action={formAction}
      pending={busy}
      onCancel={onClose}
      onDirty={onDirty}
      error={state.error ?? deleteError}
      submitLabel={credential ? 'Save credential' : 'Add credential'}
      className="mt-5 rounded-2xl border border-ocean-100 bg-ocean-50/35 p-4 sm:p-5"
      footerStart={credential && !confirmingDelete ? (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={busy}
          aria-label={`Delete ${credential.name}`}
          className="min-h-10 rounded-xl px-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
        >
          Delete
        </button>
      ) : null}
    >
      <p className="text-xs font-semibold uppercase tracking-[.13em] text-ocean-700">{credential ? 'Edit credential' : 'Add credential'}</p>
      <p className="mt-1 text-sm leading-5 text-muted">
        New credentials are self-reported until Sea N Shore&apos;s evidence review confirms them.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Certificate / CoC name
          <input name="name" maxLength={180} defaultValue={credential?.name ?? ''} className={inputClass} placeholder="Certificate of Competency - Master" />
          <ProfileCardFieldError fieldErrors={errors} name="name" />
        </label>
        <label className={labelClass}>
          Issuing authority
          <input name="issuer" maxLength={180} defaultValue={credential?.issuer ?? ''} className={inputClass} placeholder="DG Shipping India" />
          <ProfileCardFieldError fieldErrors={errors} name="issuer" />
        </label>
        <label className={labelClass}>
          Credential number
          <input name="credentialNumber" maxLength={180} defaultValue={credential?.credentialNumber ?? ''} className={inputClass} />
          <ProfileCardFieldError fieldErrors={errors} name="credentialNumber" />
        </label>
        <label className={labelClass}>
          Issue date
          <input name="issuedOn" type="date" defaultValue={credential?.issuedOn ?? ''} className={inputClass} />
          <ProfileCardFieldError fieldErrors={errors} name="issuedOn" />
        </label>
        <label className={labelClass}>
          Expiry date
          <input name="expiresOn" type="date" defaultValue={credential?.expiresOn ?? ''} disabled={noExpiry} className={inputClass} />
          <ProfileCardFieldError fieldErrors={errors} name="expiresOn" />
        </label>
        <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950">
          <input name="noExpiry" type="checkbox" checked={noExpiry} onChange={(event) => setNoExpiry(event.target.checked)} />
          This credential does not expire
        </label>
      </div>

      {credential && confirmingDelete ? (
        <div
          role="group"
          aria-label={`Confirm deleting ${credential.name}`}
          className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setConfirmingDelete(false)
            }
          }}
        >
          <p className="text-sm text-red-800">Delete this credential from your profile?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={remove} disabled={busy} className="min-h-10 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-60">
              {deleting ? 'Deleting…' : 'Delete credential'}
            </button>
            <button type="button" autoFocus onClick={() => setConfirmingDelete(false)} disabled={busy} className="min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:border-ocean-300">
              Keep it
            </button>
          </div>
        </div>
      ) : null}
    </ProfileCardForm>
  )
}

function CredentialEntry({
  credential,
  editable,
}: {
  credential: ProfileCredentialRecord
  editable: boolean
}) {
  const editor = useProfileCardEditor(`credential:${credential.id}`, credential.name)
  const issued = dateLabel(credential.issuedOn)
  const expiry = credential.noExpiry ? 'No expiry' : dateLabel(credential.expiresOn)

  if (editable && editor.editing) {
    return (
      <div className="lg:col-span-2">
        <CredentialEditor cardId={`credential:${credential.id}`} credential={credential} onClose={editor.close} onDirty={editor.markDirty} />
      </div>
    )
  }

  return (
    <article className="rounded-2xl border border-mist-100 bg-white p-4 shadow-sm max-md:rounded-none max-md:border-0 max-md:p-0 max-md:shadow-none sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${verificationClass(credential.verificationState)}`}>
              {credential.verificationState === 'verified' ? <BadgeCheck aria-hidden="true" className="size-3.5" /> : <ShieldCheck aria-hidden="true" className="size-3.5" />}
              {verificationLabel(credential.verificationState)}
            </span>
          </div>
          <h3 className="mt-3 text-base font-semibold leading-6 text-navy-950">{credential.name}</h3>
          <p className="mt-1 text-sm text-ink">{credential.issuer}</p>
          {credential.credentialNumber ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-1 text-sm text-muted">
              <span>Credential no.</span>
              <span className="font-medium text-ink">{credential.credentialNumber}</span>
            </div>
          ) : null}
        </div>

        {editable ? (
          <button ref={editor.triggerRef} type="button" onClick={editor.open} aria-label={`Edit ${credential.name}`} className={itemPencilClass}>
            <Pencil aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>

      {(issued || expiry) ? (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-mist-100 pt-3 text-sm text-muted">
          {issued ? <span className="inline-flex items-center gap-1.5"><CalendarDays aria-hidden="true" className="size-4" />Issued {issued}</span> : null}
          {expiry ? <span className="inline-flex items-center gap-1.5"><FileCheck2 aria-hidden="true" className="size-4" />{credential.noExpiry ? expiry : `Expires ${expiry}`}</span> : null}
        </div>
      ) : null}
    </article>
  )
}

/**
 * Licences & Credentials. Maritime enthusiasts and seafarer families are not asked for credentials
 * (round 11): the card only shows for them when they already have some, editable and deletable,
 * without an Add button. The public profile hides an empty card.
 */
export function ProfileCredentialWallet({
  credentials,
  editable = false,
  persona = null,
}: {
  credentials: ProfileCredentialRecord[]
  editable?: boolean
  /** The owner's profile type; null keeps the card for everyone. */
  persona?: Persona | null
}) {
  const adder = useProfileCardEditor('credential:new', 'Add credential')
  const canAdd = editable && (!persona || personaUsesCredentials(persona))
  const adding = canAdd && adder.editing

  if (credentials.length === 0 && !canAdd) return null

  return (
    <ProfileSection
      id="profile-credentials"
      title="Licences & Credentials"
      action={canAdd && !adding ? (
        <button ref={adder.triggerRef} type="button" onClick={adder.open} className={PHONE_ICON_ADD_BUTTON_CLASS} aria-label="Add credential">
          <Plus aria-hidden="true" className="size-4 max-md:size-5" />
          <span className="max-md:sr-only">Add credential</span>
        </button>
      ) : null}
    >
      {adding ? <CredentialEditor cardId="credential:new" onClose={adder.close} onDirty={adder.markDirty} /> : null}

      {credentials.length ? (
        <PhoneShowAll noun="credentials" className="mt-6 grid gap-3 max-md:mt-4 max-md:gap-5 lg:grid-cols-2" itemClassName="contents">
          {credentials.map((credential) => (
            <CredentialEntry key={credential.id} credential={credential} editable={editable} />
          ))}
        </PhoneShowAll>
      ) : canAdd && !adding ? (
        <div className="mt-6 rounded-2xl border border-dashed border-mist-100 bg-mist-50/50 p-6 text-center">
          <FileCheck2 aria-hidden="true" className="mx-auto size-7 text-ocean-600" />
          <p className="mt-2 text-sm font-semibold text-navy-950">Add your maritime credentials</p>
          <p className="mt-1 text-sm text-muted">New credentials are self-reported until a formal evidence review confirms them.</p>
          <button type="button" onClick={adder.open} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-800 transition-colors">
            <Plus aria-hidden="true" className="size-4" />
            Add your first credential
          </button>
        </div>
      ) : null}
    </ProfileSection>
  )
}
