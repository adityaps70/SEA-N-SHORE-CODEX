'use client'

import { useActionState, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { completeActivation, type ProfileActionState } from '../actions'
import {
  findIdentityOption,
  searchIdentityOptions,
  type IdentityOption,
  type IdentityRoot,
} from '../identity-catalog'

function firstError(state: ProfileActionState, field: string) {
  return state.fieldErrors?.[field]?.[0]
}

function readSecondaryIdentities(value?: string) {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function rootLabel(root: IdentityRoot) {
  return root === 'professional' ? 'Professional' : 'Organisation'
}

function IdentityRootButton({
  root,
  selected,
  onSelect,
}: {
  root: IdentityRoot
  selected: boolean
  onSelect: (root: IdentityRoot) => void
}) {
  const description = root === 'professional'
    ? 'Build your individual maritime identity around the work you actually do.'
    : 'Represent a maritime organisation with its exact industry role.'

  return (
    <button
      type="button"
      onClick={() => onSelect(root)}
      aria-pressed={selected}
      className={`rounded-2xl border p-5 text-left transition ${selected ? 'border-ocean-700 bg-ocean-50 shadow-sm' : 'border-mist-100 bg-white hover:border-ocean-300'}`}
    >
      <span className="block text-lg font-semibold text-navy-950">{rootLabel(root)}</span>
      <span className="mt-1 block text-sm leading-6 text-muted">{description}</span>
    </button>
  )
}

function IdentityResult({
  option,
  onSelect,
}: {
  option: IdentityOption
  onSelect: (option: IdentityOption) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(option)}
      className="flex w-full items-start justify-between gap-4 rounded-xl border border-mist-100 bg-white px-4 py-3 text-left transition hover:border-ocean-300 hover:bg-ocean-50"
      aria-label={`${option.label} — ${option.family}`}
    >
      <span className="font-semibold text-navy-950">{option.label}</span>
      <span className="text-right text-xs font-medium text-muted">{option.family}</span>
    </button>
  )
}

function OnboardingFields({
  initialFullName,
  state,
}: {
  initialFullName: string
  state: ProfileActionState
}) {
  const values = state.values
  const initialRoot = values?.identityRoot
  const initialPrimary = initialRoot && values?.primaryIdentity
    ? findIdentityOption(initialRoot, values.primaryIdentity) ?? {
        root: initialRoot,
        label: values.primaryIdentity,
        family: values.primaryIdentityFamily ?? 'Custom identity',
      }
    : undefined

  const [root, setRoot] = useState<IdentityRoot | undefined>(initialRoot)
  const [primary, setPrimary] = useState<IdentityOption | undefined>(initialPrimary)
  const [search, setSearch] = useState('')
  const [secondarySearch, setSecondarySearch] = useState('')
  const [secondary, setSecondary] = useState<string[]>(readSecondaryIdentities(values?.secondaryIdentities))
  const [customOpen, setCustomOpen] = useState(initialPrimary?.family === 'Custom identity')
  const [customIdentity, setCustomIdentity] = useState(initialPrimary?.family === 'Custom identity' ? initialPrimary.label : '')

  const results = useMemo(
    () => root ? searchIdentityOptions(root, search, search ? 12 : 8) : [],
    [root, search],
  )
  const secondaryResults = useMemo(
    () => root && secondarySearch ? searchIdentityOptions(root, secondarySearch, 8) : [],
    [root, secondarySearch],
  )

  function chooseRoot(nextRoot: IdentityRoot) {
    if (nextRoot !== root) {
      setPrimary(undefined)
      setSecondary([])
      setSearch('')
      setSecondarySearch('')
      setCustomOpen(false)
      setCustomIdentity('')
    }
    setRoot(nextRoot)
  }

  function choosePrimary(option: IdentityOption) {
    setPrimary(option)
    setSearch('')
    setCustomOpen(false)
    setCustomIdentity('')
    setSecondary((items) => items.filter((item) => item.toLocaleLowerCase() !== option.label.toLocaleLowerCase()))
  }

  function chooseCustom() {
    if (!root) return
    const label = customIdentity.trim()
    if (label.length < 2) return
    choosePrimary({ root, label, family: 'Custom identity' })
  }

  function addSecondary(label: string) {
    const normalized = label.trim()
    if (!normalized || normalized.toLocaleLowerCase() === primary?.label.toLocaleLowerCase()) return
    setSecondary((items) => {
      if (items.some((item) => item.toLocaleLowerCase() === normalized.toLocaleLowerCase())) return items
      return [...items, normalized].slice(0, 10)
    })
    setSecondarySearch('')
  }

  const identityError = firstError(state, 'primaryIdentity') ?? firstError(state, 'identityRoot')
  const contactVisibilityError = firstError(state, 'contactVisibility')

  return (
    <>
      <fieldset>
        <legend className="text-xl font-semibold tracking-tight text-navy-950">I’m joining as</legend>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Start with one clear identity. You can add more professional capacities without turning onboarding into a CV form.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <IdentityRootButton root="professional" selected={root === 'professional'} onSelect={chooseRoot} />
          <IdentityRootButton root="organisation" selected={root === 'organisation'} onSelect={chooseRoot} />
        </div>
      </fieldset>

      {root ? (
        <fieldset className="grid gap-5 rounded-3xl border border-mist-100 bg-mist-50 p-5 sm:p-7">
          <legend className="px-2 text-xl font-semibold tracking-tight text-navy-950">Choose your exact maritime identity</legend>
          <p className="text-sm leading-6 text-muted">Search by role, function, or maritime sector. Your selected identity will be kept exactly as chosen on your profile.</p>

          {primary ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ocean-200 bg-white p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Primary identity</p>
                <p data-primary-identity="true" className="mt-1 text-lg font-semibold text-navy-950">{primary.label}</p>
                <p className="text-sm text-muted">{primary.family}</p>
              </div>
              <button type="button" onClick={() => setPrimary(undefined)} className="text-sm font-semibold text-ocean-700 hover:underline">Change</button>
            </div>
          ) : (
            <div className="grid gap-3">
              <label className="grid gap-2 text-sm font-medium text-navy-900">
                Search {root} identities
                <input
                  type="search"
                  aria-label={`Search ${root} identities`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={root === 'professional' ? 'Try “Chief Engineer” or “Marine Surveyor”' : 'Try “Shipowner” or “Classification Society”'}
                  className="min-h-12 rounded-xl border border-mist-100 bg-white px-4 text-base text-ink shadow-sm placeholder:text-muted focus:border-ocean-700"
                />
              </label>
              <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
                {results.map((option) => <IdentityResult key={`${option.family}:${option.label}`} option={option} onSelect={choosePrimary} />)}
              </div>
            </div>
          )}

          <div className="border-t border-mist-100 pt-4">
            <button type="button" onClick={() => setCustomOpen((open) => !open)} className="text-sm font-semibold text-ocean-700 hover:underline">
              Can’t find your {root === 'professional' ? 'role' : 'organisation type'}? Add a custom identity
            </button>
            {customOpen ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={customIdentity}
                  onChange={(event) => setCustomIdentity(event.target.value)}
                  aria-label="Custom maritime identity"
                  placeholder="Enter the exact identity"
                  className="min-h-12 flex-1 rounded-xl border border-mist-100 bg-white px-4 text-base text-ink shadow-sm focus:border-ocean-700"
                />
                <Button type="button" onClick={chooseCustom} disabled={customIdentity.trim().length < 2}>Use this identity</Button>
              </div>
            ) : null}
          </div>

          {identityError ? <p className="text-sm text-red-700">{identityError}</p> : null}

          <div className="border-t border-mist-100 pt-5">
            <p className="text-sm font-semibold text-navy-950">Add another identity <span className="font-normal text-muted">(optional)</span></p>
            <p className="mt-1 text-sm text-muted">Useful if you also work as a mentor, auditor, trainer, adviser, or in another maritime capacity.</p>
            <input
              type="search"
              aria-label="Search additional identities"
              value={secondarySearch}
              onChange={(event) => setSecondarySearch(event.target.value)}
              placeholder="Search another identity"
              className="mt-3 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-4 text-sm text-ink shadow-sm focus:border-ocean-700"
            />
            {secondarySearch ? (
              <div className="mt-2 grid max-h-56 gap-2 overflow-y-auto">
                {secondaryResults
                  .filter((option) => option.label !== primary?.label && !secondary.includes(option.label))
                  .map((option) => (
                    <button
                      key={`${option.family}:${option.label}`}
                      type="button"
                      onClick={() => addSecondary(option.label)}
                      className="rounded-xl border border-mist-100 bg-white px-4 py-2 text-left text-sm hover:border-ocean-300"
                    >
                      <span className="font-semibold text-navy-950">{option.label}</span>
                      <span className="ml-2 text-muted">{option.family}</span>
                    </button>
                  ))}
              </div>
            ) : null}
            {secondary.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {secondary.map((label) => (
                  <span key={label} className="inline-flex items-center gap-2 rounded-full bg-ocean-50 px-3 py-1.5 text-sm font-medium text-ocean-800">
                    {label}
                    <button type="button" aria-label={`Remove ${label}`} onClick={() => setSecondary((items) => items.filter((item) => item !== label))}>×</button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      {root ? (
        <fieldset className="grid gap-5">
          <legend className="text-xl font-semibold tracking-tight text-navy-950">Your profile basics</legend>
          <p className="text-sm leading-6 text-muted">Keep this short. You can add experience, skills, certificates and professional records after joining.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={root === 'organisation' ? 'Organisation name' : 'Full name'}
              name="fullName"
              defaultValue={values?.fullName ?? initialFullName}
              error={firstError(state, 'fullName')}
              autoComplete={root === 'organisation' ? 'organization' : 'name'}
              required
            />
            <Field label="Profile address" name="slug" defaultValue={values?.slug} error={firstError(state, 'slug')} hint="Letters, numbers, and hyphens — for example asha-singh." autoComplete="off" required />
            <Field label="Location" name="location" defaultValue={values?.location} error={firstError(state, 'location')} autoComplete="address-level2" />
            {root === 'professional' ? (
              <Field label="Current organisation" name="currentCompany" defaultValue={values?.currentCompany} error={firstError(state, 'currentCompany')} autoComplete="organization" />
            ) : null}
            <Field label="Professional headline" name="headline" defaultValue={values?.headline} error={firstError(state, 'headline')} hint="Optional — your exact primary identity will be used if left blank." />
          </div>
          <label htmlFor="contactVisibility" className="grid gap-2 text-sm font-medium text-navy-900 sm:max-w-sm">
            Who can see my contact details?
            <select
              id="contactVisibility"
              name="contactVisibility"
              defaultValue={values?.contactVisibility ?? 'members'}
              aria-invalid={Boolean(contactVisibilityError)}
              aria-describedby={contactVisibilityError ? 'contactVisibility-description' : undefined}
              className="min-h-12 rounded-xl border border-mist-100 bg-white px-4 text-base text-ink shadow-sm focus:border-ocean-700"
            >
              <option value="private">Only me</option>
              <option value="members">Sea N Shore members</option>
              <option value="public">Everyone</option>
            </select>
            {contactVisibilityError ? <span id="contactVisibility-description" className="text-red-700">{contactVisibilityError}</span> : null}
          </label>
        </fieldset>
      ) : null}

      <input type="hidden" name="identityRoot" value={root ?? ''} />
      <input type="hidden" name="primaryIdentity" value={primary?.label ?? ''} />
      <input type="hidden" name="primaryIdentityFamily" value={primary?.family ?? ''} />
      <input type="hidden" name="secondaryIdentities" value={JSON.stringify(secondary)} />
    </>
  )
}

export function OnboardingForm({ initialFullName }: { initialFullName: string }) {
  const [state, formAction, pending] = useActionState(completeActivation, { revision: 0 })

  return (
    <form action={formAction} className="onboarding-form grid gap-10" noValidate>
      <OnboardingFields key={state.revision ?? 0} initialFullName={initialFullName} state={state} />

      {state.error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p> : null}
      <div className="flex flex-col gap-3 border-t border-mist-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm leading-6 text-muted">Join first. Build the deeper professional record at your own pace.</p>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? 'Saving your profile…' : 'Complete profile'}
        </Button>
      </div>
    </form>
  )
}
