'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState, useSyncExternalStore } from 'react'
import { Compass, X } from 'lucide-react'
import type { Persona } from '@/features/profiles/persona'
import { updateProfileRoleSection, type ProfileInlineActionState } from '@/features/profiles/profile-inline-actions'
import { ProfileRoleFields, type ProfileRoleInitialValues } from './profile-role-fields'

const DISMISSED_KEY = 'sns:rank-banner-dismissed'

function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

const initialState: ProfileInlineActionState = {}

/**
 * Round 12: "Select your rank so jobs can match you", shown once on Home and My Profile to a
 * Seafarer or Student / Cadet without a rank key, or a member whose old rank text was not
 * recognised. The picker opens in place; saving clears it, and it can be dismissed.
 */
export function RankSelectionBanner({ persona, initial }: { persona: Persona; initial: ProfileRoleInitialValues }) {
  const router = useRouter()
  // Hidden while rendering on the server, so a dismissed banner never flashes.
  const dismissedEarlier = useSyncExternalStore(subscribe, readDismissed, () => true)
  const [dismissed, setDismissed] = useState(false)
  const [open, setOpen] = useState(false)

  async function submit(previousState: ProfileInlineActionState, formData: FormData) {
    const nextState = await updateProfileRoleSection(previousState, formData)
    if (nextState.success) {
      setOpen(false)
      router.refresh()
    }
    return nextState
  }
  const [state, formAction, pending] = useActionState(submit, initialState)

  if (dismissedEarlier || dismissed || state.success) return null

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Storage can be unavailable; the banner is hidden for this visit anyway.
    }
    setDismissed(true)
  }

  const word = persona === 'student_cadet' ? 'target job role' : persona === 'seafarer' ? 'rank' : 'role'

  return (
    <section aria-label={`Select your ${word}`} data-testid="rank-selection-banner" className="rounded-2xl border border-ocean-100 bg-ocean-50/60 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-ocean-700"><Compass aria-hidden="true" className="size-4.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-navy-950">Select your {word} so jobs can match you</p>
          {!open ? (
            <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900">
              Select {word}
            </button>
          ) : (
            <form action={formAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <ProfileRoleFields persona={persona} variant="card" initial={initial} error={(name) => state.fieldErrors?.[name]?.[0]} />
              {state.error ? <p role="alert" className="text-sm font-medium text-red-700 sm:col-span-2">{state.error}</p> : null}
              <div className="flex gap-2 sm:col-span-2">
                <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900 disabled:cursor-wait disabled:opacity-60">
                  {pending ? 'Saving…' : 'Save'}
                </button>
                <button type="button" disabled={pending} onClick={() => setOpen(false)} className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="grid size-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-white hover:text-navy-950">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </section>
  )
}
