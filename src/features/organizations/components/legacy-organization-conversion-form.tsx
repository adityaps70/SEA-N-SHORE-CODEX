'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check, ShieldCheck, UserRound } from 'lucide-react'
import {
  PERSONAS,
  PERSONA_LABELS,
  PROFILE_INTENTS,
  PROFILE_INTENT_LABELS,
  type Persona,
  type ProfileIntent,
} from '@/features/profiles/persona'
import {
  completeLegacyOrganizationConversion,
  type LegacyOrganizationConversionActionState,
} from '../legacy-conversion-actions'
import type { LegacyOrganizationConversionState } from '../legacy-conversion-repository'

function firstError(state: LegacyOrganizationConversionActionState, field: string) {
  return state.fieldErrors?.[field]?.[0]
}

export function LegacyOrganizationConversionForm({
  conversion,
}: {
  conversion: LegacyOrganizationConversionState
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(completeLegacyOrganizationConversion, {})
  const [fullName, setFullName] = useState(state.values?.fullName ?? '')
  const [persona, setPersona] = useState<Persona>(state.values?.persona ?? 'shore_professional')
  const [headline, setHeadline] = useState(state.values?.headline ?? '')
  const [intents, setIntents] = useState<ProfileIntent[]>(() => {
    const raw = state.values?.profileIntents
    if (!raw) return ['network']
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is ProfileIntent =>
          typeof item === 'string' && PROFILE_INTENTS.includes(item as ProfileIntent))
        : ['network']
    } catch {
      return ['network']
    }
  })
  const [strategy, setStrategy] = useState<'existing' | 'create'>(
    conversion.eligibleOrganizations.length ? 'existing' : 'create',
  )
  const [companyId, setCompanyId] = useState(conversion.eligibleOrganizations[0]?.id ?? '')
  const [newOrganizationName, setNewOrganizationName] = useState(
    conversion.legacyOrganization.name === 'Legacy organization'
      ? ''
      : conversion.legacyOrganization.name,
  )

  useEffect(() => {
    if (state.ok) router.replace('/home')
  }, [router, state.ok])

  function toggleIntent(intent: ProfileIntent) {
    setIntents((current) =>
      current.includes(intent)
        ? current.filter((entry) => entry !== intent)
        : [...current, intent],
    )
  }

  return (
    <form action={formAction} className="grid gap-7" noValidate>
      {state.error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-900">
          {state.error}
        </div>
      ) : null}

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
            <UserRound aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Step 1</p>
            <h2 className="mt-1 text-xl font-bold text-navy-950">Your personal identity</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Your login and user ID stay the same. Replace the old organization-style profile with the real person who manages it.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-navy-900">
            Full name
            <input
              name="fullName"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
            />
            {firstError(state, 'fullName') ? <span className="text-xs text-red-700">{firstError(state, 'fullName')}</span> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-navy-900">
            Which best describes you?
            <select
              name="persona"
              value={persona}
              onChange={(event) => setPersona(event.target.value as Persona)}
              className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
            >
              {PERSONAS.map((item) => (
                <option key={item} value={item}>{PERSONA_LABELS[item]}</option>
              ))}
            </select>
            {firstError(state, 'persona') ? <span className="text-xs text-red-700">{firstError(state, 'persona')}</span> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-navy-900 sm:col-span-2">
            Personal role / headline
            <input
              name="headline"
              value={headline}
              onChange={(event) => setHeadline(event.target.value)}
              placeholder="For example: Marine Manager, Crewing Director, Master Mariner"
              className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
            />
            {firstError(state, 'headline') ? <span className="text-xs text-red-700">{firstError(state, 'headline')}</span> : null}
          </label>
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-navy-900">What are you here to do?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PROFILE_INTENTS.map((intent) => {
              const selected = intents.includes(intent)
              return (
                <button
                  key={intent}
                  type="button"
                  aria-label={PROFILE_INTENT_LABELS[intent]}
                  aria-pressed={selected}
                  onClick={() => toggleIntent(intent)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                    selected
                      ? 'border-ocean-700 bg-ocean-700 text-white'
                      : 'border-mist-100 bg-white text-navy-900 hover:border-ocean-300'
                  }`}
                >
                  {selected ? '✓ ' : ''}{PROFILE_INTENT_LABELS[intent]}
                </button>
              )
            })}
          </div>
          {firstError(state, 'profileIntents') ? <p className="mt-2 text-xs text-red-700">{firstError(state, 'profileIntents')}</p> : null}
        </fieldset>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-mist-50 text-navy-950">
            <Building2 aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Step 2</p>
            <h2 className="mt-1 text-xl font-bold text-navy-950">Your organization workspace</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              The old organization identity is preserved separately. Choose where that organization should live after your personal profile is converted.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-xl bg-mist-50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Old organization profile preserved</p>
          <p className="mt-1 font-bold text-navy-950">{conversion.legacyOrganization.name}</p>
          {conversion.legacyOrganization.headline ? <p className="mt-1 text-sm text-muted">{conversion.legacyOrganization.headline}</p> : null}
        </div>

        {conversion.eligibleOrganizations.length ? (
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-mist-100 p-4">
            <input
              type="radio"
              name="strategyChoice"
              checked={strategy === 'existing'}
              onChange={() => setStrategy('existing')}
              className="mt-1"
            />
            <span>
              <span className="block font-bold text-navy-950">Use an organization I already manage</span>
              <span className="mt-1 block text-sm leading-6 text-muted">Available only for approved Owner or Administrator memberships.</span>
            </span>
          </label>
        ) : null}

        {strategy === 'existing' && conversion.eligibleOrganizations.length ? (
          <div className="mt-3 grid gap-2 pl-7">
            {conversion.eligibleOrganizations.map((organization) => (
              <label key={organization.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-mist-100 p-3">
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="companyChoice"
                    checked={companyId === organization.id}
                    onChange={() => setCompanyId(organization.id)}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-navy-950">{organization.name}</span>
                    <span className="block text-xs text-muted">{organization.role === 'owner' ? 'Owner' : 'Administrator'}</span>
                  </span>
                </span>
                {organization.verified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800">
                    <ShieldCheck aria-hidden="true" className="size-3" /> Verified
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        ) : null}

        <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-mist-100 p-4">
          <input
            type="radio"
            name="strategyChoice"
            checked={strategy === 'create'}
            onChange={() => setStrategy('create')}
            className="mt-1"
          />
          <span>
            <span className="block font-bold text-navy-950">Create an organization from my old account</span>
            <span className="mt-1 block text-sm leading-6 text-muted">
              Old logo, description and location move into a new unverified organization workspace. Company verification remains separate.
            </span>
          </span>
        </label>

        {strategy === 'create' ? (
          <label className="mt-3 grid gap-1.5 pl-7 text-sm font-semibold text-navy-900">
            Organization name
            <input
              name="newOrganizationName"
              value={newOrganizationName}
              onChange={(event) => setNewOrganizationName(event.target.value)}
              className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
            />
            {firstError(state, 'newOrganizationName') ? <span className="text-xs text-red-700">{firstError(state, 'newOrganizationName')}</span> : null}
          </label>
        ) : null}

        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          If this organization already exists on Sea N Shore, do not create another copy.{' '}
          <Link href="/hiring/organization" className="font-bold underline underline-offset-2">
            Use Claim Existing Organization
          </Link>{' '}
          and request Administrator access first.
        </div>

        {firstError(state, 'companyId') ? <p className="mt-3 text-xs text-red-700">{firstError(state, 'companyId')}</p> : null}
      </section>

      <input type="hidden" name="profileIntents" value={JSON.stringify(intents)} />
      <input type="hidden" name="strategy" value={strategy} />
      <input type="hidden" name="companyId" value={strategy === 'existing' ? companyId : ''} />
      {strategy === 'existing' ? <input type="hidden" name="newOrganizationName" value="" /> : null}

      <div className="flex flex-col gap-3 rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 text-sm leading-6 text-muted">
          <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-emerald-700" />
          Your login, messages, posts, connections and historical activity remain attached to the same user ID.
        </div>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? 'Converting account…' : 'Complete conversion'}
        </button>
      </div>
    </form>
  )
}
