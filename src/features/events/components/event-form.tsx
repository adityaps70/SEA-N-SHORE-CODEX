'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition, type ChangeEvent, type ReactNode } from 'react'
import { ChevronDown, ImageUp, Info, MapPin, Monitor, MonitorSmartphone, Ticket, Trash2, Wallet } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { focusFirstFormError } from '@/components/ui/form-error-summary'
import { CURRENCY_LABELS, DEFAULT_PAYMENT_CURRENCY, isPaymentCurrency, minorToPriceInput, parsePriceToMinor } from '@/features/payments/currency'
import { CURRENCY_UNAVAILABLE_ORGANIZER_MESSAGE } from '@/features/payments/event-payment-rules'
import { PAYMENT_CURRENCIES, type PaymentCurrency } from '@/features/payments/types'
import { cancelEventAction, createEventAction, createEventBannerUploadAction, updateEventAction } from '../calendar-actions'
import { calendarFieldErrors, parseCalendarEventInput } from '../calendar-validation'
import { EVENT_BANNER_MAX_BYTES, EVENT_BANNER_MIME_TYPES } from '../event-banner-policy'
import { EVENT_TIMEZONES } from '../event-timezones'
import {
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_EVENT_TYPES,
  type CalendarEvent,
  type CalendarEventCategory,
  type CalendarEventCreateInput,
  type CalendarEventField,
  type CalendarEventFormat,
  type CalendarEventInput,
  type CalendarEventPricing,
  type CalendarEventType,
  type CalendarFieldErrors,
  type CalendarSpeakerDetail,
} from '../calendar-types'
import type { EventPublisherOption } from '../publishers'
import { EventDateTimeField } from './event-date-time-field'
import { uploadEventBannerFile } from './upload-event-banner'

type Props =
  | { mode: 'create'; publisherOptions: EventPublisherOption[]; paymentsConfigured: boolean; paymentCurrencies?: readonly PaymentCurrency[]; initial?: never; eventId?: never }
  | { mode: 'edit'; initial: CalendarEvent; eventId: string; paymentsConfigured: boolean; paymentCurrencies?: readonly PaymentCurrency[]; publisherOptions?: never }

const inputClass = 'min-h-12 w-full rounded-2xl border border-mist-100 bg-mist-50 px-4 py-3 text-[15px] font-normal text-navy-950 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-teal-500 aria-[invalid=true]:border-rose-300'
const selectClass = `${inputClass} appearance-none pr-10 font-semibold`
const labelClass = 'space-y-2 text-sm font-semibold text-navy-900'
const helperClass = 'block text-xs font-normal leading-5 text-muted'
const sectionClass = 'rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-7'

const FORMAT_OPTIONS: { value: CalendarEventFormat; label: string; description: string; icon: typeof Monitor }[] = [
  { value: 'online', label: 'Online', description: 'People join from anywhere with a meeting or registration link.', icon: Monitor },
  { value: 'in_person', label: 'Offline', description: 'People attend in person at a venue.', icon: MapPin },
  { value: 'hybrid', label: 'Hybrid', description: 'A venue for people in the room and a link for everyone else.', icon: MonitorSmartphone },
]

const PRICING_OPTIONS: { value: CalendarEventPricing; label: string; description: string; icon: typeof Ticket }[] = [
  { value: 'free', label: 'Free', description: 'Anyone can register with one click.', icon: Ticket },
  { value: 'paid', label: 'Paid', description: 'Attendees buy a ticket inside Sea N Shore to confirm their seat.', icon: Wallet },
]

const FIELD_LABELS: Partial<Record<CalendarEventField, string>> = {
  title: 'Title',
  summary: 'Short summary',
  startAt: 'Starts',
  endAt: 'Ends',
  timezone: 'Timezone',
  meetingUrl: 'Meeting or registration link',
  locationName: 'Venue',
  locationAddress: 'Address',
  city: 'City',
  country: 'Country',
  priceMinor: 'Ticket price',
  currency: 'Currency',
  capacity: 'Capacity',
  registrationClosesAt: 'Registration closes',
  pricing: 'Tickets',
  format: 'How people attend',
}

type LocationState = {
  locationName: string
  locationAddress: string
  city: string
  country: string
  meetingUrl: string
}

function text(data: FormData, key: string) { return String(data.get(key) ?? '').trim() }
function csv(data: FormData, key: string) { return [...new Set(text(data, key).split(',').map((item) => item.trim()).filter(Boolean))] }
function lines(data: FormData, key: string) { return text(data, key).split('\n').map((item) => item.trim()).filter(Boolean) }
function orNull(value: string) { return value.trim() || null }
function datetimeLocal(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
function isoOrEmpty(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('invalid_date')
  return date.toISOString()
}
function speakerDetails(data: FormData): CalendarSpeakerDetail[] {
  return lines(data, 'speakerDetails').map((line) => {
    const [name = '', title = '', organization = ''] = line.split('|').map((part) => part.trim())
    return { name, title, organization }
  }).filter((speaker) => speaker.name)
}
function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }

export function buildEventInput(data: FormData, state: { format: CalendarEventFormat; pricing: CalendarEventPricing; currency: PaymentCurrency; priceText: string; location: LocationState }): CalendarEventInput {
  const categoryValue = text(data, 'category')
  const category: CalendarEventCategory = CALENDAR_EVENT_CATEGORIES.find((value) => value === categoryValue) ?? 'community'
  const eventTypeValue = text(data, 'eventType')
  const eventType: CalendarEventType = CALENDAR_EVENT_TYPES.find((value) => value === eventTypeValue) ?? 'community'
  const registrationClosesValue = text(data, 'registrationClosesAt')
  const capacityValue = text(data, 'capacity')
  const detail = speakerDetails(data)
  const online = state.format !== 'in_person'
  const offline = state.format !== 'online'
  const paid = state.pricing === 'paid'
  return {
    title: text(data, 'title'),
    summary: text(data, 'summary'),
    description: text(data, 'description'),
    category,
    eventType,
    format: state.format,
    status: text(data, 'status') === 'draft' ? 'draft' : 'published',
    startAt: isoOrEmpty(text(data, 'startAt')),
    endAt: isoOrEmpty(text(data, 'endAt')),
    timezone: text(data, 'timezone') || 'UTC',
    locationName: offline ? orNull(state.location.locationName) : null,
    locationAddress: offline ? orNull(state.location.locationAddress) : null,
    city: offline ? orNull(state.location.city) : null,
    country: offline ? orNull(state.location.country) : null,
    meetingUrl: online ? orNull(state.location.meetingUrl) : null,
    topics: csv(data, 'topics'),
    agenda: lines(data, 'agenda'),
    speakers: detail.length ? detail.map((speaker) => speaker.name) : csv(data, 'speakers'),
    speakerDetails: detail,
    capacity: capacityValue ? Number(capacityValue) : null,
    bannerUrl: orNull(text(data, 'bannerUrl')),
    registrationMode: text(data, 'registrationMode') === 'closed' ? 'closed' : 'open',
    registrationClosesAt: registrationClosesValue ? isoOrEmpty(registrationClosesValue) : null,
    pricing: state.pricing,
    priceMinor: paid ? parsePriceToMinor(state.priceText, state.currency) : null,
    currency: paid ? state.currency : null,
  }
}

function SelectChevron() {
  return <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
}

function FieldError({ name, errors }: { name: CalendarEventField; errors: CalendarFieldErrors }) {
  const message = errors[name]
  return message ? <span id={`event-field-${name}-error`} className="block text-xs font-semibold leading-5 text-rose-700">{message}</span> : null
}

function fieldProps(name: CalendarEventField, errors: CalendarFieldErrors, helperId?: string) {
  const describedBy = [errors[name] ? `event-field-${name}-error` : null, helperId ?? null].filter(Boolean).join(' ')
  return {
    id: `event-field-${name}`,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': describedBy || undefined,
  } as const
}

function ChoiceCards<T extends string>({ name, legend, value, options, onChange, error }: {
  name: CalendarEventField
  legend: ReactNode
  value: T
  options: { value: T; label: string; description: string; icon: typeof Monitor }[]
  onChange: (value: T) => void
  error?: string
}) {
  return (
    <fieldset id={`event-field-${name}`} aria-describedby={error ? `event-field-${name}-error` : undefined}>
      <legend className="text-sm font-semibold text-navy-900">{legend}</legend>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {options.map((option) => {
          const selected = option.value === value
          const Icon = option.icon
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer gap-3 rounded-2xl border p-4 transition has-[:focus-visible]:border-teal-500 ${selected ? 'border-teal-500 bg-teal-50/60' : 'border-mist-100 bg-white hover:border-teal-300'}`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-1 shrink-0 accent-teal-600"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-bold text-navy-950"><Icon aria-hidden="true" className="size-4 text-teal-700" />{option.label}</span>
                <span className="mt-1 block text-xs font-normal leading-5 text-muted">{option.description}</span>
              </span>
            </label>
          )
        })}
      </div>
      {error ? <p id={`event-field-${name}-error`} className="mt-2 text-xs font-semibold text-rose-700">{error}</p> : null}
    </fieldset>
  )
}

export function EventForm(props: Props) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const keepEventRef = useRef<HTMLButtonElement>(null)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<CalendarFieldErrors>({})
  const [attemptedStatus, setAttemptedStatus] = useState<'draft' | 'published' | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const initial = props.mode === 'edit' ? props.initial : undefined
  const initialPublisher = props.mode === 'create'
    ? props.publisherOptions.find((option) => option.canPublish) ?? props.publisherOptions[0] ?? null
    : null
  const [publisherKey, setPublisherKey] = useState(initialPublisher?.key ?? '')
  const selectedPublisher = props.mode === 'create'
    ? props.publisherOptions.find((option) => option.key === publisherKey) ?? null
    : null
  const [format, setFormat] = useState<CalendarEventFormat>(initial?.format ?? 'online')
  const [pricing, setPricing] = useState<CalendarEventPricing>(initial?.pricing ?? 'free')
  const [currency, setCurrency] = useState<PaymentCurrency>(isPaymentCurrency(initial?.currency) ? initial.currency : DEFAULT_PAYMENT_CURRENCY)
  const [priceText, setPriceText] = useState(minorToPriceInput(initial?.priceMinor, isPaymentCurrency(initial?.currency) ? initial.currency : DEFAULT_PAYMENT_CURRENCY))
  const [location, setLocation] = useState<LocationState>({
    locationName: initial?.locationName ?? '',
    locationAddress: initial?.locationAddress ?? '',
    city: initial?.city ?? '',
    country: initial?.country ?? '',
    meetingUrl: initial?.meetingUrl ?? '',
  })
  const [bannerReference, setBannerReference] = useState(initial?.bannerStoragePath ?? initial?.bannerUrl ?? '')
  const [bannerPreview, setBannerPreview] = useState<string | null>(initial?.bannerUrl ?? null)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [bannerProgress, setBannerProgress] = useState(0)
  const localPreviewRef = useRef<string | null>(null)
  const busy = pending || bannerUploading
  const initialTimezone = initial?.timezone ?? 'Asia/Kolkata'
  const timezoneIsListed = EVENT_TIMEZONES.some((zone) => zone.value === initialTimezone)
  const errorEntries = Object.entries(fieldErrors).filter((entry): entry is [CalendarEventField, string] => Boolean(entry[1]))

  useEffect(() => () => {
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current)
  }, [])

  useEffect(() => {
    if (confirmingCancel) keepEventRef.current?.focus()
  }, [confirmingCancel])

  function updateLocation(key: keyof LocationState, value: string) {
    setLocation((current) => ({ ...current, [key]: value }))
    clearFieldError(key)
  }

  function clearFieldError(key: CalendarEventField) {
    setFieldErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function showErrors(errors: CalendarFieldErrors, summary: string | null) {
    setFieldErrors(errors)
    setError(true)
    setMessage(summary)
    // The summary is announced (role="alert"); move focus to the first field that needs attention.
    requestAnimationFrame(() => {
      if (Object.keys(errors).length) focusFirstFormError(formRef.current)
      else summaryRef.current?.focus()
    })
  }

  function setLocalPreview(file: File) {
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current)
    const preview = URL.createObjectURL(file)
    localPreviewRef.current = preview
    setBannerPreview(preview)
  }

  async function uploadBanner(file: File) {
    setMessage(null)
    setError(false)
    if (!EVENT_BANNER_MIME_TYPES.some((mimeType) => mimeType === file.type)) {
      setError(true)
      setMessage('Use a JPEG, PNG or WebP banner image.')
      return
    }
    if (file.size <= 0 || file.size > EVENT_BANNER_MAX_BYTES) {
      setError(true)
      setMessage('Banner images must be 8 MB or smaller.')
      return
    }

    setBannerUploading(true)
    setBannerProgress(0)
    try {
      const result = await createEventBannerUploadAction({ mimeType: file.type, size: file.size })
      if (!result.ok) throw new Error(result.error)
      await uploadEventBannerFile({ uploadUrl: result.upload.uploadUrl, file, onProgress: setBannerProgress })
      setBannerReference(result.upload.storagePath)
      setLocalPreview(file)
      setMessage('Banner uploaded. It will be saved with the event.')
    } catch (uploadError) {
      setError(true)
      setMessage(uploadError instanceof Error && uploadError.message !== 'event_banner_upload_failed' ? uploadError.message : 'We could not upload the banner. Please try again.')
    } finally {
      setBannerUploading(false)
    }
  }

  function onBannerChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void uploadBanner(file)
  }

  function removeBanner() {
    if (localPreviewRef.current) {
      URL.revokeObjectURL(localPreviewRef.current)
      localPreviewRef.current = null
    }
    setBannerReference('')
    setBannerPreview(null)
    setBannerProgress(0)
  }

  function submit(data: FormData) {
    if (bannerUploading) return
    setMessage(null)
    setError(false)
    setFieldErrors({})
    let input: CalendarEventInput
    try {
      input = buildEventInput(data, { format, pricing, currency, priceText, location })
    } catch {
      setAttemptedStatus(text(data, 'status') === 'draft' ? 'draft' : 'published')
      showErrors({ startAt: 'Check the date and time.' }, null)
      return
    }
    setAttemptedStatus(input.status)

    const checked = parseCalendarEventInput(input)
    if (!checked.success) {
      showErrors(calendarFieldErrors(checked.error), null)
      return
    }

    if (props.mode === 'create') {
      if (!selectedPublisher) {
        showErrors({ publisher: 'Choose who is publishing this event.' }, null)
        return
      }
      if (input.status === 'published' && !selectedPublisher.canPublish) {
        setError(true)
        setMessage(
          selectedPublisher.blocker === 'verification_required'
            ? 'Verification is required before this identity can publish events. You can still save the event as a draft.'
            : 'A qualifying Pro plan is required before this identity can publish events. You can still save the event as a draft.',
        )
        return
      }
    }

    startTransition(async () => {
      if (props.mode === 'create') {
        const publisher = selectedPublisher!
        const result = await createEventAction({
          ...input,
          publisherType: publisher.kind,
          companyId: publisher.kind === 'organization' ? publisher.id : null,
        } satisfies CalendarEventCreateInput)
        if (!result.ok) {
          if (result.fieldErrors && Object.keys(result.fieldErrors).length) showErrors(result.fieldErrors, null)
          else showErrors({}, result.error)
          return
        }
        router.push(`/events/${result.eventId}`)
        return
      }

      const result = await updateEventAction(props.eventId, input)
      if (!result.ok) {
        if (result.fieldErrors && Object.keys(result.fieldErrors).length) showErrors(result.fieldErrors, null)
        else showErrors({}, result.error)
        return
      }
      setMessage(input.status === 'published' ? 'Event saved and published.' : 'Draft saved.')
      router.refresh()
    })
  }

  function cancelEvent() {
    if (props.mode !== 'edit') return
    startTransition(async () => {
      const result = await cancelEventAction(props.eventId)
      if (!result.ok) {
        setConfirmingCancel(false)
        setError(true)
        setMessage(result.error)
        return
      }
      router.push(`/events/${props.eventId}`)
      router.refresh()
    })
  }

  const publishBlocked = attemptedStatus === 'published' && errorEntries.length > 0

  return (
    <form ref={formRef} action={submit} noValidate className="space-y-6">
      {props.mode === 'create' ? (
        <section id="event-field-publisher" className={sectionClass}>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Publishing identity</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Publish as</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted">
            Host personally or on behalf of an organization where you have event-management responsibility.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {props.publisherOptions.map((option) => {
              const selected = publisherKey === option.key
              return (
                <label
                  key={option.key}
                  className={`cursor-pointer rounded-2xl border p-4 transition ${
                    selected
                      ? 'border-teal-500 bg-teal-50/60 ring-1 ring-teal-100'
                      : 'border-mist-100 bg-white hover:border-teal-300'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="publisherIdentity"
                      value={option.key}
                      checked={selected}
                      onChange={() => setPublisherKey(option.key)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-navy-950">{option.name}</span>
                        <span className="rounded-full bg-mist-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                          {option.kind === 'personal' ? 'Personal' : 'Organization'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {option.kind === 'personal'
                          ? 'Host under your professional Sea N Shore identity.'
                          : `Host for this organization${option.role ? ` · ${option.role.replaceAll('_', ' ')}` : ''}.`}
                      </p>

                      {option.blocker === 'upgrade_required' ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900">PRO required to publish</span>
                          <Link href="/plans" className="text-xs font-bold text-teal-700 hover:underline">
                            View plans
                          </Link>
                        </div>
                      ) : null}

                      {option.blocker === 'verification_required' ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900">Verification required to publish</span>
                          <span className="text-xs text-muted">
                            {option.kind === 'personal'
                              ? 'Event organizer verification must be approved.'
                              : 'The organization must be verified.'}
                          </span>
                          {option.kind === 'personal' ? (
                            <Link href="/settings/verifications/event-host" className="text-xs font-bold text-teal-700 hover:underline">
                              Apply for verification
                            </Link>
                          ) : null}
                        </div>
                      ) : null}

                      {!option.canPublish ? (
                        <p className="mt-2 text-xs leading-5 text-muted">You can still choose this identity and save a draft.</p>
                      ) : null}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
          <FieldError name="publisher" errors={fieldErrors} />
        </section>
      ) : (
        <section className="rounded-[1.5rem] border border-mist-100 bg-mist-50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Publishing identity</p>
          <p className="mt-1 text-sm font-bold text-navy-950">{initial?.publisherName}</p>
          <p className="mt-1 text-xs text-muted">The publishing identity is locked after event creation.</p>
        </section>
      )}

      <section className={sectionClass}>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Event basics</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Tell people what the event is about</h2>
        <p className="mt-1.5 text-sm font-normal text-muted">Keep the essentials clear first. You can add the richer programme details below.</p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>Title<input className={inputClass} name="title" maxLength={180} defaultValue={initial?.title ?? ''} placeholder="e.g. SIRE 2.0 readiness masterclass" onChange={() => clearFieldError('title')} {...fieldProps('title', fieldErrors)} /><FieldError name="title" errors={fieldErrors} /></label>
          <label className={`${labelClass} sm:col-span-2`}>Short summary<textarea className={`${inputClass} min-h-24 resize-y`} name="summary" maxLength={600} defaultValue={initial?.summary ?? ''} placeholder="A short promise of what maritime professionals will gain." onChange={() => clearFieldError('summary')} {...fieldProps('summary', fieldErrors)} /><FieldError name="summary" errors={fieldErrors} /></label>
          <label className={`${labelClass} sm:col-span-2`}>Description<textarea className={`${inputClass} min-h-40 resize-y`} name="description" maxLength={12000} defaultValue={initial?.description ?? ''} placeholder="Add learning outcomes, intended audience and useful preparation." /></label>

          <label className={labelClass}>Category<div className="relative"><select className={selectClass} name="category" defaultValue={initial?.category ?? 'community'}>{CALENDAR_EVENT_CATEGORIES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select><SelectChevron /></div></label>
          <label className={labelClass}>Event type<div className="relative"><select className={selectClass} name="eventType" defaultValue={initial?.eventType ?? 'webinar'}>{CALENDAR_EVENT_TYPES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select><SelectChevron /></div></label>
        </div>
      </section>

      <section className={sectionClass}>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Schedule</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Set the date, time and timezone</h2>
        <p className="mt-1.5 text-sm font-normal text-muted">Pick the day from the calendar, then set the start and end times.</p>
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <EventDateTimeField label="Starts" name="startAt" required defaultValue={datetimeLocal(initial?.startAt)} error={fieldErrors.startAt} />
          <EventDateTimeField label="Ends" name="endAt" required defaultValue={datetimeLocal(initial?.endAt)} error={fieldErrors.endAt} />
          <label className={`${labelClass} lg:col-span-2`}>Timezone<div className="relative"><select className={selectClass} name="timezone" defaultValue={initialTimezone} {...fieldProps('timezone', fieldErrors)}>{!timezoneIsListed ? <option value={initialTimezone}>{initialTimezone}</option> : null}{EVENT_TIMEZONES.map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}</select><SelectChevron /></div><span className={helperClass}>Times will be labelled with this timezone for attendees.</span><FieldError name="timezone" errors={fieldErrors} /></label>
        </div>
      </section>

      <section className={sectionClass}>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Location & access</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Where it happens</h2>
        <p className="mt-1.5 text-sm font-normal text-muted">Choose how people attend. Only the details for that choice are shown and saved.</p>
        <div className="mt-6">
          <ChoiceCards
            name="format"
            legend="How people attend"
            value={format}
            options={FORMAT_OPTIONS}
            onChange={(value) => {
              setFormat(value)
              setFieldErrors((current) => {
                const next = { ...current }
                delete next.meetingUrl
                delete next.locationName
                delete next.city
                delete next.country
                return next
              })
            }}
            error={fieldErrors.format}
          />
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          {format !== 'online' ? (
            <>
              <label className={`${labelClass} sm:col-span-2`}>Venue<input className={inputClass} name="locationName" value={location.locationName} onChange={(event) => updateLocation('locationName', event.target.value)} placeholder="e.g. Maritime Training Centre" maxLength={240} {...fieldProps('locationName', fieldErrors)} /><FieldError name="locationName" errors={fieldErrors} /></label>
              <label className={`${labelClass} sm:col-span-2`}>Address <span className="font-normal text-muted">(optional)</span><input className={inputClass} name="locationAddress" value={location.locationAddress} onChange={(event) => updateLocation('locationAddress', event.target.value)} placeholder="Street, building or landmark" maxLength={500} {...fieldProps('locationAddress', fieldErrors)} /><FieldError name="locationAddress" errors={fieldErrors} /></label>
              <label className={labelClass}>City<input className={inputClass} name="city" value={location.city} onChange={(event) => updateLocation('city', event.target.value)} placeholder="e.g. Mumbai" maxLength={160} {...fieldProps('city', fieldErrors)} /><FieldError name="city" errors={fieldErrors} /></label>
              <label className={labelClass}>Country<input className={inputClass} name="country" value={location.country} onChange={(event) => updateLocation('country', event.target.value)} placeholder="e.g. India" maxLength={160} {...fieldProps('country', fieldErrors)} /><FieldError name="country" errors={fieldErrors} /></label>
            </>
          ) : null}
          {format !== 'in_person' ? (
            <label className={`${labelClass} sm:col-span-2`}>Meeting or registration link<input className={inputClass} type="url" inputMode="url" name="meetingUrl" value={location.meetingUrl} onChange={(event) => updateLocation('meetingUrl', event.target.value)} placeholder="https://zoom.us/… or Microsoft Teams link" {...fieldProps('meetingUrl', fieldErrors, 'meeting-url-help')} /><span id="meeting-url-help" className={helperClass}>Paste the Zoom, Teams or other joining link. Only the host and registered attendees can see it.</span><FieldError name="meetingUrl" errors={fieldErrors} /></label>
          ) : null}
        </div>
      </section>

      <section className={sectionClass}>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Tickets & registration</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Free or paid, and who can register</h2>
        <div className="mt-6">
          <ChoiceCards
            name="pricing"
            legend="Tickets"
            value={pricing}
            options={PRICING_OPTIONS}
            onChange={(value) => {
              setPricing(value)
              clearFieldError('priceMinor')
              clearFieldError('currency')
            }}
            error={fieldErrors.pricing}
          />
        </div>

        {pricing === 'paid' ? (
          <div className="mt-6 space-y-4">
            <div className="grid gap-5 sm:grid-cols-2">
              <label className={labelClass}>Ticket price
                <div className="relative">
                  <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-navy-700">{currency === 'INR' ? '₹' : '$'}</span>
                  <input className={`${inputClass} pl-9`} name="price" inputMode="decimal" autoComplete="off" value={priceText} onChange={(event) => { setPriceText(event.target.value); clearFieldError('priceMinor') }} placeholder={currency === 'INR' ? 'e.g. 499' : 'e.g. 25'} {...fieldProps('priceMinor', fieldErrors, 'price-help')} />
                </div>
                <span id="price-help" className={helperClass}>Price per attendee, including any taxes. Up to two decimal places.</span>
                <FieldError name="priceMinor" errors={fieldErrors} />
              </label>
              <label className={labelClass}>Currency<div className="relative"><select className={selectClass} name="currency" value={currency} onChange={(event) => { if (isPaymentCurrency(event.target.value)) setCurrency(event.target.value); clearFieldError('currency') }} {...fieldProps('currency', fieldErrors)}>{PAYMENT_CURRENCIES.map((code) => <option key={code} value={code}>{CURRENCY_LABELS[code]}</option>)}</select><SelectChevron /></div><FieldError name="currency" errors={fieldErrors} /></label>
            </div>
            <p className="flex gap-2 rounded-2xl bg-mist-50 p-4 text-xs leading-5 text-navy-700">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-teal-700" />
              <span>Attendees pay inside Sea N Shore by card, UPI or net banking, and their seat is confirmed as soon as the payment succeeds. You can refund a ticket from the event&apos;s Paid registrations page. Payouts of your share (the ticket price minus the Sea N Shore platform fee) are handled by the Sea N Shore team outside the site for now.</span>
            </p>
            {props.paymentsConfigured && props.paymentCurrencies && !props.paymentCurrencies.includes(currency) ? (
              <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-5 text-amber-900">
                {CURRENCY_UNAVAILABLE_ORGANIZER_MESSAGE}
              </p>
            ) : null}
            {!props.paymentsConfigured ? (
              <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-5 text-amber-900">
                Payments aren&apos;t switched on for Sea N Shore yet. You can still save and publish this paid event, but attendees will see &ldquo;Registration opens soon&rdquo; until payments are set up.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className={labelClass}>Registration<div className="relative"><select className={selectClass} name="registrationMode" defaultValue={initial?.registrationMode ?? 'open'}><option value="open">Open</option><option value="closed">Closed</option></select><SelectChevron /></div></label>
          <label className={labelClass}>Capacity <span className="font-normal text-muted">(optional)</span><input className={`${inputClass} appearance-none`} type="number" inputMode="numeric" min="1" max="1000000" name="capacity" defaultValue={initial?.capacity ?? ''} placeholder="No limit" onChange={() => clearFieldError('capacity')} {...fieldProps('capacity', fieldErrors)} /><FieldError name="capacity" errors={fieldErrors} /></label>
          <div className="sm:col-span-2">
            <EventDateTimeField label="Registration closes" name="registrationClosesAt" defaultValue={datetimeLocal(initial?.registrationClosesAt)} helper="Optional. Keep this before the event starts." error={fieldErrors.registrationClosesAt} />
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Programme</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Content & speakers</h2>
        <p className="mt-1.5 text-sm font-normal text-muted">These details help professionals decide quickly whether the session is relevant to them.</p>
        <div className="mt-6 grid gap-5">
          <label className={labelClass}>Topics<input className={inputClass} name="topics" defaultValue={initial?.topics.join(', ') ?? ''} placeholder="e.g. SIRE 2.0, tanker operations, human factors" /><span className={helperClass}>Separate multiple topics with commas.</span></label>
          <label className={labelClass}>Agenda<textarea className={`${inputClass} min-h-36 resize-y`} name="agenda" defaultValue={initial?.agenda.join('\n') ?? ''} placeholder={'e.g. 09:00 Welcome\n09:15 SIRE 2.0 readiness\n11:30 Q&A'} /><span className={helperClass}>One agenda item per line.</span></label>
          <label className={labelClass}>Speaker details<textarea className={`${inputClass} min-h-32 resize-y`} name="speakerDetails" defaultValue={initial?.speakerDetails.map((speaker) => [speaker.name, speaker.title, speaker.organization].join(' | ')).join('\n') ?? ''} placeholder={'e.g. Capt. Name | Master Mariner | Company\nChief Engineer Name | Technical Director | Company'} /><span className={helperClass}>One speaker per line: Name | Title | Organization.</span></label>
          <label className={labelClass}>Speaker names only <span className="font-normal text-muted">(optional fallback)</span><input className={inputClass} name="speakers" defaultValue={initial?.speakers.join(', ') ?? ''} placeholder="e.g. Capt. Name, Chief Engineer Name" /></label>
        </div>
      </section>

      <section className={sectionClass}>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Presentation</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Event banner</h2>
        <div className="mt-6 space-y-2">
          <div className="flex items-end justify-between gap-3"><div><p className="text-sm font-semibold text-navy-900">Banner image</p><p className="mt-1 text-xs font-normal text-muted">JPEG, PNG or WebP up to 8 MB. A 16:9 image works best.</p></div>{bannerReference ? <button type="button" onClick={removeBanner} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 aria-hidden="true" className="size-3.5" />Remove</button> : null}</div>
          <input type="hidden" name="bannerUrl" value={bannerReference} />
          <label className="group block cursor-pointer overflow-hidden rounded-2xl border border-dashed border-mist-200 bg-mist-50 transition hover:border-teal-300 hover:bg-teal-50/40">
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={onBannerChange} />
            {bannerPreview ? (
              <div className="relative aspect-[16/7] overflow-hidden bg-navy-950">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={bannerPreview} alt="Event banner preview" className="h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-navy-950/90 to-transparent px-4 pb-4 pt-10 text-white"><span className="text-sm font-bold">{bannerUploading ? `Uploading ${bannerProgress}%` : 'Banner ready'}</span><span className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold group-hover:bg-teal-400 group-hover:text-navy-950">Replace banner</span></div>
              </div>
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center"><span className="grid size-11 place-items-center rounded-2xl bg-white text-teal-700 shadow-sm"><ImageUp aria-hidden="true" className="size-5" /></span><span className="mt-3 text-sm font-bold text-navy-950">Upload banner</span><span className="mt-1 text-xs font-normal text-muted">Click to choose an image from your device</span>{bannerUploading ? <span className="mt-3 text-xs font-bold text-teal-700">Uploading {bannerProgress}%</span> : null}</div>
            )}
          </label>
        </div>
      </section>

      {errorEntries.length || (error && message) ? (
        <div ref={summaryRef} role="alert" tabIndex={-1} data-form-error-summary="true" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900 outline-none">
          <p className="font-bold">
            {publishBlocked ? "This event can't be published yet" : errorEntries.length ? 'Please fix the highlighted details' : 'We could not save the event'}
          </p>
          {errorEntries.length ? (
            <>
              {publishBlocked ? <p className="mt-1 leading-6">Add the missing details below, or choose Save draft to finish later.</p> : null}
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {errorEntries.map(([field, fieldMessage]) => (
                  <li key={field}>
                    <a href={`#event-field-${field}`} className="underline-offset-2 hover:underline">
                      {FIELD_LABELS[field] ? <span className="font-semibold">{FIELD_LABELS[field]}: </span> : null}{fieldMessage}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {message && error ? <p className="mt-1 leading-6">{message}</p> : null}
        </div>
      ) : message ? (
        <p role="status" className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</p>
      ) : null}

      {confirmingCancel && props.mode === 'edit' ? (
        <div
          role="alertdialog"
          aria-labelledby="cancel-event-title"
          aria-describedby="cancel-event-body"
          onKeyDown={(event) => { if (event.key === 'Escape') setConfirmingCancel(false) }}
          className="rounded-2xl border border-rose-200 bg-white p-4 shadow-sm"
        >
          <p id="cancel-event-title" className="font-bold text-navy-950">Cancel this event?</p>
          <p id="cancel-event-body" className="mt-1 text-sm leading-6 text-navy-700">
            Attendees will see it as cancelled and registration will close. This can&apos;t be undone.
            {initial?.pricing === 'paid' ? ' People who paid will be refunded by the Sea N Shore team.' : ''}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button ref={keepEventRef} type="button" onClick={() => setConfirmingCancel(false)} disabled={pending} className="min-h-11 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 hover:bg-mist-50 disabled:opacity-60">Keep event</button>
            <button type="button" onClick={cancelEvent} disabled={pending} className="min-h-11 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60">{pending ? 'Cancelling…' : 'Yes, cancel event'}</button>
          </div>
        </div>
      ) : null}

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex flex-wrap gap-3 rounded-2xl border border-mist-100 bg-white/95 p-3 shadow-xl backdrop-blur sm:p-4 md:bottom-3">
        <button disabled={busy} type="submit" name="status" value="draft" className="rounded-xl border border-navy-200 bg-white px-5 py-3 text-sm font-bold text-navy-900 disabled:opacity-60 enabled:hover:border-ocean-300 enabled:hover:bg-mist-50 transition-colors disabled:cursor-not-allowed">{bannerUploading ? 'Uploading banner…' : pending ? 'Saving…' : initial?.status === 'published' ? 'Unpublish to draft' : 'Save draft'}</button>
        <button disabled={busy} type="submit" name="status" value="published" className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-60">{pending ? 'Saving…' : initial?.status === 'published' ? 'Save & keep published' : 'Publish event'}</button>
        {props.mode === 'edit' ? <button disabled={busy} type="button" onClick={() => setConfirmingCancel(true)} aria-expanded={confirmingCancel} className="rounded-xl border border-rose-200 px-5 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60 sm:ml-auto">Cancel event</button> : null}
      </div>
    </form>
  )
}
