'use client'

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react'
import { Info } from 'lucide-react'
import { organizationTypeGroups, type OrganizationTypeCode } from '@/features/organizations/organization-types'
import { createUnclaimedOrganization } from '@/features/organizations/unclaimed-organization-actions'
import { cn } from '@/lib/cn'
import type { LinkedOrganization } from '../organization-link'

const TYPE_GROUPS = organizationTypeGroups()

const fieldClass = 'mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-normal text-ink outline-none focus:border-ocean-500 focus-visible:ring-2 focus-visible:ring-ocean-100 aria-[invalid=true]:border-red-300'
const labelClass = 'block text-sm font-semibold text-navy-950'

type FieldErrors = Record<string, string[] | undefined>

/**
 * "I just work there": a small inline form that adds an unclaimed organization
 * page and hands it back to the organization picker to link.
 *
 * It sits inside the profile or onboarding <form>, so it is not a form itself:
 * its inputs have no `name` (they are never submitted with the profile) and
 * Enter adds the organization instead of submitting the outer form.
 */
export function UnclaimedOrganizationForm({
  initialName,
  onAdded,
  onUseExisting,
  onCancel,
}: {
  initialName: string
  onAdded: (organization: LinkedOrganization) => void
  onUseExisting: (organization: LinkedOrganization) => void
  onCancel: () => void
}) {
  const baseId = useId()
  const headingId = `${baseId}-heading`
  const [name, setName] = useState(initialName.trim())
  const [organizationType, setOrganizationType] = useState<OrganizationTypeCode | ''>('')
  const [location, setLocation] = useState('')
  const [website, setWebsite] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [existing, setExisting] = useState<LinkedOrganization | null>(null)
  const [pending, startTransition] = useTransition()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  function submit() {
    if (pending) return
    setError(null)
    setFieldErrors({})
    setExisting(null)
    startTransition(async () => {
      try {
        const result = await createUnclaimedOrganization({ name, organizationType, location, website })
        if (result.ok) {
          onAdded(result.organization)
          return
        }
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        setExisting(result.existing ?? null)
      } catch {
        setError('We could not reach Sea N Shore to add this organization. Check your connection and try again.')
      }
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault()
      submit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  const describedBy = (field: string) => (fieldErrors[field]?.[0] ? `${baseId}-${field}-error` : undefined)
  const fieldError = (field: string) => fieldErrors[field]?.[0]
    ? <span id={`${baseId}-${field}-error`} className="mt-1 block text-xs font-medium text-red-700">{fieldErrors[field]?.[0]}</span>
    : null

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      className="mt-2 rounded-2xl border border-ocean-100 bg-ocean-50/40 p-4 text-left font-normal"
    >
      <h3 id={headingId} className="text-sm font-bold text-navy-950">Add your organization</h3>
      <p className="mt-1 flex gap-2 text-xs leading-5 text-muted">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-ocean-700" />
        This creates a basic, unclaimed page your colleagues can link to. Nobody manages it and it cannot post jobs, events or courses until someone who runs the organization claims it and Sea N Shore verifies them.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${baseId}-name`} className={labelClass}>
            Organization name
          </label>
          <input
            id={`${baseId}-name`}
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={160}
            autoComplete="organization"
            aria-invalid={Boolean(fieldErrors.name?.[0])}
            aria-describedby={describedBy('name')}
            className={fieldClass}
          />
          {fieldError('name')}
        </div>
        <div>
          <label htmlFor={`${baseId}-organizationType`} className={labelClass}>
            Type or industry
          </label>
          <select
            id={`${baseId}-organizationType`}
            value={organizationType}
            onChange={(event) => setOrganizationType(event.target.value as OrganizationTypeCode | '')}
            aria-invalid={Boolean(fieldErrors.organizationType?.[0])}
            aria-describedby={describedBy('organizationType')}
            className={fieldClass}
          >
            <option value="">Choose a type…</option>
            {TYPE_GROUPS.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.types.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
              </optgroup>
            ))}
          </select>
          {fieldError('organizationType')}
        </div>
        <div>
          <label htmlFor={`${baseId}-location`} className={labelClass}>
            City and country
          </label>
          <input
            id={`${baseId}-location`}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={120}
            placeholder="Mumbai, India"
            aria-invalid={Boolean(fieldErrors.location?.[0])}
            aria-describedby={describedBy('location')}
            className={fieldClass}
          />
          {fieldError('location')}
        </div>
        <div>
          <label htmlFor={`${baseId}-website`} className={labelClass}>
            <span>Website <span className="font-normal text-muted">(optional)</span></span>
          </label>
          <input
            id={`${baseId}-website`}
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            maxLength={320}
            inputMode="url"
            placeholder="company.com"
            aria-invalid={Boolean(fieldErrors.website?.[0])}
            aria-describedby={describedBy('website')}
            className={fieldClass}
          />
          {fieldError('website')}
        </div>
      </div>

      {error && !Object.values(fieldErrors).some((messages) => messages?.length) ? (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {existing ? (
        <button
          type="button"
          onClick={() => onUseExisting(existing)}
          className="mt-3 inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-ocean-200 bg-white px-3 text-sm font-semibold text-ocean-700 hover:bg-ocean-50"
        >
          Use {existing.name} instead
        </button>
      ) : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-10 cursor-pointer rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition-colors hover:border-ocean-300 hover:bg-mist-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={cn(
            'min-h-10 cursor-pointer rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition-colors enabled:hover:bg-navy-800',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          {pending ? 'Adding…' : 'Add and link'}
        </button>
      </div>
    </div>
  )
}
