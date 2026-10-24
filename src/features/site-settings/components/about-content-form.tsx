'use client'

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { FormErrorSummary, focusFirstFormError } from '@/components/ui/form-error-summary'
import { supportInputClass, supportPrimaryButtonClass, supportSecondaryButtonClass } from '@/features/support/components/form-styles'
import { createSiteImageUploadAction, saveAboutPageAction, type SiteSettingsFormState } from '../admin-actions'
import { downscaleImage, imageReencodeErrorMessage } from '@/lib/images/downscale-image'
import { ABOUT_LIMITS, SITE_IMAGE_MAX_BYTES, SITE_IMAGE_TYPES, type AboutPageContent, type AboutPartner, type AboutPerson } from '../schemas'

type PeopleListKey = 'founders' | 'team'
type ListKey = PeopleListKey | 'partners'

const EMPTY_PERSON: AboutPerson = { name: '', role: '', bio: '', photoPath: null, profileUrl: null }
const EMPTY_PARTNER: AboutPartner = { name: '', logoPath: null, websiteUrl: null }

const smallButton = 'inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-50'

/** Uploads one image through a short-lived link and returns its storage path. */
async function uploadSiteImage(picked: File): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const refused = { ok: false, error: 'Choose a PNG, JPEG or WebP image of 2 MB or less.' } as const
  if (!(picked.type in SITE_IMAGE_TYPES)) return refused
  let file: File
  try {
    // Round P3: always re-encoded in the browser, so EXIF metadata (GPS included) is removed.
    file = await downscaleImage(picked, 'cover')
  } catch (prepareError) {
    return { ok: false, error: imageReencodeErrorMessage(prepareError, 'The image could not be uploaded. Please try again.') }
  }
  if (!(file.type in SITE_IMAGE_TYPES) || file.size > SITE_IMAGE_MAX_BYTES) return refused
  const prepared = await createSiteImageUploadAction({ contentType: file.type, size: file.size })
  if (!prepared.ok) return prepared
  try {
    const response = await fetch(prepared.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
    if (!response.ok) return { ok: false, error: 'The image could not be uploaded. Please try again.' }
  } catch {
    return { ok: false, error: 'The image could not be uploaded. Check your connection and try again.' }
  }
  return { ok: true, path: prepared.path }
}

function ImageField({
  id,
  label,
  path,
  previewUrl,
  onChange,
  error,
}: {
  id: string
  label: string
  path: string | null
  previewUrl: string | null
  onChange: (path: string | null, preview: string | null) => void
  error?: string
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const describedBy = [`${id}-hint`, error || message ? `${id}-status` : null].filter(Boolean).join(' ')

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-navy-900">{label}</label>
      <div className="flex flex-wrap items-center gap-3">
        {path && previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- an admin preview of a signed or local (blob:) image
          <img src={previewUrl} alt="" className="size-14 rounded-lg border border-mist-100 bg-white object-contain" />
        ) : null}
        <input
          id={id}
          type="file"
          accept={Object.keys(SITE_IMAGE_TYPES).join(',')}
          disabled={busy}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className="min-w-0 max-w-full text-sm text-navy-900 file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-mist-200 file:bg-white file:px-3 file:text-sm file:font-semibold"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            setBusy(true)
            setMessage('Uploading…')
            const result = await uploadSiteImage(file)
            setBusy(false)
            if (!result.ok) {
              setMessage(result.error)
              event.target.value = ''
              return
            }
            setMessage('Uploaded. Save the About page to publish it.')
            onChange(result.path, URL.createObjectURL(file))
          }}
        />
        {path ? (
          <button type="button" className={smallButton} onClick={() => { onChange(null, null); setMessage('Image removed. Save the About page to publish the change.') }}>
            Remove image
          </button>
        ) : null}
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted">PNG, JPEG or WebP, 2 MB or less.</p>
      <p id={`${id}-status`} role="status" aria-live="polite" className={error ? 'text-sm text-red-700' : 'text-sm text-muted'}>{error ?? message ?? ''}</p>
    </div>
  )
}

function TextInput({ id, label, value, onChange, error, maxLength, type = 'text', hint, multiline = false }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  maxLength: number
  type?: string
  hint?: string
  multiline?: boolean
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined
  const shared = {
    id,
    value,
    maxLength,
    'aria-invalid': Boolean(error),
    'aria-describedby': describedBy,
  }
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-navy-900">{label}</label>
      {multiline
        ? <textarea {...shared} rows={3} onChange={(event) => onChange(event.target.value)} className={`${supportInputClass} min-h-24 py-2.5 leading-6`} />
        : <input {...shared} type={type} onChange={(event) => onChange(event.target.value)} className={supportInputClass} />}
      {error ? <p id={`${id}-error`} className="text-sm text-red-700">{error}</p> : null}
      {hint ? <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

function ListSection({ title, description, children, addLabel, onAdd, canAdd }: { title: string; description: string; children: ReactNode; addLabel: string; onAdd: () => void; canAdd: boolean }) {
  const headingId = useId()
  return (
    <fieldset aria-labelledby={headingId} className="grid gap-3 rounded-2xl border border-mist-100 p-4">
      <legend className="sr-only">{title}</legend>
      <div>
        <h3 id={headingId} className="text-base font-semibold text-navy-950">{title}</h3>
        <p className="mt-0.5 text-sm text-muted">{description}</p>
      </div>
      {children}
      <div>
        <button type="button" className={supportSecondaryButtonClass} onClick={onAdd} disabled={!canAdd}>{addLabel}</button>
      </div>
    </fieldset>
  )
}

/**
 * Round H (H7): Admin › Site settings › About page. Founders, team and partners are lists the owner
 * fills in; any list left empty is left out of the About page. Member numbers are live counts, shown
 * only when switched on.
 */
export function AboutContentForm({
  initial,
  imageUrls,
  liveCounts,
}: {
  initial: AboutPageContent
  /** Signed preview links for the images already saved, by storage path. */
  imageUrls: Record<string, string>
  /** Today's live counts, so the owner sees what would be shown. */
  liveCounts: { members: number | null; organizations: number | null; courses: number | null }
}) {
  const [state, formAction, pending] = useActionState<SiteSettingsFormState<AboutPageContent>, FormData>(saveAboutPageAction, { status: 'idle' })
  const [content, setContent] = useState<AboutPageContent>(initial)
  const [previews, setPreviews] = useState<Record<string, string>>(imageUrls)
  const [lastState, setLastState] = useState(state)
  const formRef = useRef<HTMLFormElement | null>(null)
  const id = useId()
  const errors = state.fieldErrors ?? {}

  if (lastState !== state) {
    setLastState(state)
    if (state.status === 'success' && state.values) setContent(state.values)
  }

  useEffect(() => {
    if (state.status === 'error') focusFirstFormError(formRef.current)
  }, [state])

  function updateList<K extends ListKey>(key: K, update: (list: AboutPageContent[K]) => AboutPageContent[K]) {
    setContent((current) => ({ ...current, [key]: update(current[key]) }))
  }

  function move(key: ListKey, index: number, offset: -1 | 1) {
    setContent((current) => {
      const list: Array<AboutPerson | AboutPartner> = [...current[key]]
      const target = index + offset
      if (target < 0 || target >= list.length) return current
      const [item] = list.splice(index, 1)
      list.splice(target, 0, item!)
      return { ...current, [key]: list } as AboutPageContent
    })
  }

  function rowControls(key: ListKey, index: number, length: number, name: string) {
    const label = name.trim() || `entry ${index + 1}`
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" className={smallButton} disabled={index === 0} onClick={() => move(key, index, -1)} aria-label={`Move ${label} up`}>Move up</button>
        <button type="button" className={smallButton} disabled={index === length - 1} onClick={() => move(key, index, 1)} aria-label={`Move ${label} down`}>Move down</button>
        <button type="button" className={smallButton} onClick={() => updateList(key, (list) => list.filter((_, position) => position !== index) as typeof list)} aria-label={`Remove ${label}`}>Remove</button>
      </div>
    )
  }

  function peopleRows(key: PeopleListKey, noun: string) {
    const list = content[key]
    return list.length ? (
      <ol className="grid gap-4">
        {list.map((person, index) => {
          const base = `${id}-${key}-${index}`
          const error = (field: string) => errors[`${key}.${index}.${field}`]
          const set = (patch: Partial<AboutPerson>) => updateList(key, (items) => items.map((item, position) => (position === index ? { ...item, ...patch } : item)))
          return (
            <li key={`${key}-${index}`} className="grid gap-3 rounded-xl border border-mist-100 bg-mist-50/40 p-3">
              <p className="text-sm font-semibold text-navy-950">{noun} {index + 1}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput id={`${base}-name`} label="Name" value={person.name} maxLength={120} error={error('name')} onChange={(value) => set({ name: value })} />
                <TextInput id={`${base}-role`} label="Role" value={person.role} maxLength={120} error={error('role')} onChange={(value) => set({ role: value })} />
              </div>
              <TextInput id={`${base}-bio`} label="Short bio" value={person.bio} maxLength={600} multiline error={error('bio')} onChange={(value) => set({ bio: value })} />
              <TextInput id={`${base}-link`} label="Profile link" value={person.profileUrl ?? ''} maxLength={500} error={error('profileUrl')} hint="Optional. An https:// link or a Sea N Shore page such as /people/their-profile." onChange={(value) => set({ profileUrl: value || null })} />
              <ImageField
                id={`${base}-photo`}
                label="Photo"
                path={person.photoPath}
                previewUrl={person.photoPath ? previews[person.photoPath] ?? null : null}
                error={error('photoPath')}
                onChange={(path, preview) => {
                  if (path && preview) setPreviews((current) => ({ ...current, [path]: preview }))
                  set({ photoPath: path })
                }}
              />
              {rowControls(key, index, list.length, person.name)}
            </li>
          )
        })}
      </ol>
    ) : <p className="text-sm text-muted">None yet. This section is hidden on the About page.</p>
  }

  const partners = content.partners
  const numbers = content.memberNumbers
  const numberLabel = (value: number | null) => (value === null ? 'not available right now' : `currently ${value.toLocaleString('en-IN')}`)

  return (
    <form ref={formRef} action={formAction} noValidate className="grid gap-5">
      <input type="hidden" name="about" value={JSON.stringify(content)} />
      {state.status === 'error' ? (
        <FormErrorSummary error={Object.keys(errors).length ? 'Some entries need a fix. Each one is marked below.' : state.message} />
      ) : null}

      <ListSection
        title="Founders"
        description={`Up to ${ABOUT_LIMITS.founders}. Add only real people, with their agreement.`}
        addLabel="Add founder"
        canAdd={content.founders.length < ABOUT_LIMITS.founders}
        onAdd={() => updateList('founders', (list) => [...list, { ...EMPTY_PERSON }])}
      >
        {peopleRows('founders', 'Founder')}
      </ListSection>

      <ListSection
        title="Team"
        description={`Up to ${ABOUT_LIMITS.team}.`}
        addLabel="Add team member"
        canAdd={content.team.length < ABOUT_LIMITS.team}
        onAdd={() => updateList('team', (list) => [...list, { ...EMPTY_PERSON }])}
      >
        {peopleRows('team', 'Team member')}
      </ListSection>

      <ListSection
        title="Partners"
        description={`Up to ${ABOUT_LIMITS.partners}. Upload each partner's logo; it is stored in Sea N Shore's media storage.`}
        addLabel="Add partner"
        canAdd={partners.length < ABOUT_LIMITS.partners}
        onAdd={() => updateList('partners', (list) => [...list, { ...EMPTY_PARTNER }])}
      >
        {partners.length ? (
          <ol className="grid gap-4">
            {partners.map((partner, index) => {
              const base = `${id}-partners-${index}`
              const error = (field: string) => errors[`partners.${index}.${field}`]
              const set = (patch: Partial<AboutPartner>) => updateList('partners', (items) => items.map((item, position) => (position === index ? { ...item, ...patch } : item)))
              return (
                <li key={`partner-${index}`} className="grid gap-3 rounded-xl border border-mist-100 bg-mist-50/40 p-3">
                  <p className="text-sm font-semibold text-navy-950">Partner {index + 1}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextInput id={`${base}-name`} label="Name" value={partner.name} maxLength={120} error={error('name')} onChange={(value) => set({ name: value })} />
                    <TextInput id={`${base}-website`} label="Website" value={partner.websiteUrl ?? ''} maxLength={500} error={error('websiteUrl')} hint="Optional. Starts with https://." onChange={(value) => set({ websiteUrl: value || null })} />
                  </div>
                  <ImageField
                    id={`${base}-logo`}
                    label="Logo"
                    path={partner.logoPath}
                    previewUrl={partner.logoPath ? previews[partner.logoPath] ?? null : null}
                    error={error('logoPath')}
                    onChange={(path, preview) => {
                      if (path && preview) setPreviews((current) => ({ ...current, [path]: preview }))
                      set({ logoPath: path })
                    }}
                  />
                  {rowControls('partners', index, partners.length, partner.name)}
                </li>
              )
            })}
          </ol>
        ) : <p className="text-sm text-muted">None yet. This section is hidden on the About page.</p>}
      </ListSection>

      <fieldset className="grid gap-3 rounded-2xl border border-mist-100 p-4">
        <legend className="px-1 text-base font-semibold text-navy-950">Member numbers</legend>
        <label className="flex items-start gap-2.5 text-sm text-navy-950">
          <input
            type="checkbox"
            checked={numbers.enabled}
            onChange={(event) => setContent((current) => ({ ...current, memberNumbers: { ...current.memberNumbers, enabled: event.target.checked } }))}
            className="mt-0.5 size-4 shrink-0 accent-ocean-700"
          />
          <span><span className="font-semibold">Show live member numbers on the About page</span><span className="block text-xs text-muted">Counted from the site when the page loads. A number that is zero is never shown.</span></span>
        </label>
        <div className="grid gap-2 pl-6">
          {([
            ['members', 'Members (active accounts that finished sign-up)'],
            ['organizations', 'Verified organizations'],
            ['courses', 'Published courses'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-start gap-2.5 text-sm text-navy-950">
              <input
                type="checkbox"
                checked={numbers[key]}
                disabled={!numbers.enabled}
                onChange={(event) => setContent((current) => ({ ...current, memberNumbers: { ...current.memberNumbers, [key]: event.target.checked } }))}
                className="mt-0.5 size-4 shrink-0 accent-ocean-700"
              />
              <span>{label} <span className="text-muted">({numberLabel(liveCounts[key])})</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <p role="status" aria-live="polite" className={state.status === 'success' ? 'text-sm font-semibold text-emerald-800' : 'sr-only'}>
        {state.status === 'success' ? state.message : ''}
      </p>
      <div>
        <button type="submit" disabled={pending} className={`${supportPrimaryButtonClass} max-md:w-full`}>
          {pending ? 'Saving…' : 'Save About page'}
        </button>
      </div>
    </form>
  )
}
