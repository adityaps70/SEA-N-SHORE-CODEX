'use client'

import { useEffect, useRef, useState, useTransition, type ChangeEvent } from 'react'
import { ImageUp, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cancelEventAction, createEventAction, createEventBannerUploadAction, updateEventAction } from '../calendar-actions'
import { EVENT_BANNER_MAX_BYTES, EVENT_BANNER_MIME_TYPES } from '../event-banner-policy'
import {
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_EVENT_TYPES,
  type CalendarEvent,
  type CalendarEventCategory,
  type CalendarEventFormat,
  type CalendarEventInput,
  type CalendarEventType,
  type CalendarSpeakerDetail,
} from '../calendar-types'
import { uploadEventBannerFile } from './upload-event-banner'

type Props =
  | { mode: 'create'; initial?: never; eventId?: never }
  | { mode: 'edit'; initial: CalendarEvent; eventId: string }

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-navy-950 outline-none transition placeholder:text-muted focus:border-teal-500'
const labelClass = 'space-y-1.5 text-sm font-semibold text-navy-900'

function text(data: FormData, key: string) { return String(data.get(key) ?? '').trim() }
function nullableText(data: FormData, key: string) { return text(data, key) || null }
function csv(data: FormData, key: string) { return [...new Set(text(data, key).split(',').map((item) => item.trim()).filter(Boolean))] }
function lines(data: FormData, key: string) { return text(data, key).split('\n').map((item) => item.trim()).filter(Boolean) }
function datetimeLocal(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
function speakerDetails(data: FormData): CalendarSpeakerDetail[] {
  return lines(data, 'speakerDetails').map((line) => {
    const [name = '', title = '', organization = ''] = line.split('|').map((part) => part.trim())
    return { name, title, organization }
  }).filter((speaker) => speaker.name)
}
function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }

function buildInput(data: FormData): CalendarEventInput {
  const formatValue = text(data, 'format')
  const format: CalendarEventFormat = formatValue === 'in_person' || formatValue === 'hybrid' ? formatValue : 'online'
  const categoryValue = text(data, 'category')
  const category: CalendarEventCategory = CALENDAR_EVENT_CATEGORIES.find((value) => value === categoryValue) ?? 'community'
  const eventTypeValue = text(data, 'eventType')
  const eventType: CalendarEventType = CALENDAR_EVENT_TYPES.find((value) => value === eventTypeValue) ?? 'community'
  const startValue = text(data, 'startAt')
  const endValue = text(data, 'endAt')
  const registrationClosesValue = text(data, 'registrationClosesAt')
  const capacityValue = text(data, 'capacity')
  const detail = speakerDetails(data)
  return {
    title: text(data, 'title'),
    summary: text(data, 'summary'),
    description: text(data, 'description'),
    category,
    eventType,
    format,
    status: text(data, 'status') === 'draft' ? 'draft' : 'published',
    startAt: startValue ? new Date(startValue).toISOString() : '',
    endAt: endValue ? new Date(endValue).toISOString() : '',
    timezone: text(data, 'timezone') || 'UTC',
    locationName: nullableText(data, 'locationName'),
    locationAddress: nullableText(data, 'locationAddress'),
    city: nullableText(data, 'city'),
    country: nullableText(data, 'country'),
    meetingUrl: nullableText(data, 'meetingUrl'),
    topics: csv(data, 'topics'),
    agenda: lines(data, 'agenda'),
    speakers: detail.length ? detail.map((speaker) => speaker.name) : csv(data, 'speakers'),
    speakerDetails: detail,
    capacity: capacityValue ? Number(capacityValue) : null,
    bannerUrl: nullableText(data, 'bannerUrl'),
    registrationMode: text(data, 'registrationMode') === 'closed' ? 'closed' : 'open',
    registrationClosesAt: registrationClosesValue ? new Date(registrationClosesValue).toISOString() : null,
  }
}

export function EventForm(props: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const initial = props.mode === 'edit' ? props.initial : undefined
  const [bannerReference, setBannerReference] = useState(initial?.bannerStoragePath ?? initial?.bannerUrl ?? '')
  const [bannerPreview, setBannerPreview] = useState<string | null>(initial?.bannerUrl ?? null)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [bannerProgress, setBannerProgress] = useState(0)
  const localPreviewRef = useRef<string | null>(null)
  const busy = pending || bannerUploading

  useEffect(() => () => {
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current)
  }, [])

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
    let input: CalendarEventInput
    try {
      input = buildInput(data)
    } catch {
      setError(true)
      setMessage('Please check the event date and time.')
      return
    }
    startTransition(async () => {
      if (props.mode === 'create') {
        const result = await createEventAction(input)
        if (!result.ok) {
          setError(true)
          setMessage(result.error)
          return
        }
        router.push(`/events/${result.eventId}`)
        return
      }

      const result = await updateEventAction(props.eventId, input)
      if (!result.ok) {
        setError(true)
        setMessage(result.error)
        return
      }
      setMessage('Event updated successfully.')
      router.refresh()
    })
  }

  function cancelEvent() {
    if (props.mode !== 'edit' || !window.confirm('Cancel this event? Attendees will see it as cancelled.')) return
    startTransition(async () => {
      const result = await cancelEventAction(props.eventId)
      if (!result.ok) {
        setError(true)
        setMessage(result.error)
        return
      }
      router.push(`/events/${props.eventId}`)
      router.refresh()
    })
  }

  return (
    <form action={submit} className="space-y-5">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Event details</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Create a useful maritime gathering</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>Title<input className={inputClass} name="title" required maxLength={180} defaultValue={initial?.title ?? ''} placeholder="SIRE 2.0 readiness masterclass" /></label>
          <label className={`${labelClass} sm:col-span-2`}>Short summary<textarea className={`${inputClass} min-h-24`} name="summary" required maxLength={600} defaultValue={initial?.summary ?? ''} placeholder="What will maritime professionals gain from this event?" /></label>
          <label className={`${labelClass} sm:col-span-2`}>Description<textarea className={`${inputClass} min-h-40`} name="description" maxLength={12000} defaultValue={initial?.description ?? ''} placeholder="Learning outcomes, audience and preparation required." /></label>
          <label className={labelClass}>Category<select className={inputClass} name="category" defaultValue={initial?.category ?? 'community'}>{CALENDAR_EVENT_CATEGORIES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <label className={labelClass}>Event type<select className={inputClass} name="eventType" defaultValue={initial?.eventType ?? 'webinar'}>{CALENDAR_EVENT_TYPES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <label className={labelClass}>Format<select className={inputClass} name="format" defaultValue={initial?.format ?? 'online'}><option value="online">Online</option><option value="in_person">In person</option><option value="hybrid">Hybrid</option></select></label>
          <label className={labelClass}>Capacity<input className={inputClass} type="number" min="1" max="1000000" name="capacity" defaultValue={initial?.capacity ?? ''} placeholder="Optional" /></label>
          <label className={labelClass}>Starts<input className={inputClass} type="datetime-local" name="startAt" required defaultValue={datetimeLocal(initial?.startAt)} /></label>
          <label className={labelClass}>Ends<input className={inputClass} type="datetime-local" name="endAt" required defaultValue={datetimeLocal(initial?.endAt)} /></label>
          <label className={`${labelClass} sm:col-span-2`}>Timezone<input className={inputClass} name="timezone" required defaultValue={initial?.timezone ?? 'Asia/Kolkata'} placeholder="Asia/Kolkata" /><span className="block text-xs font-normal text-muted">Use an IANA timezone such as Asia/Kolkata, Europe/London or Asia/Singapore.</span></label>
          <label className={labelClass}>Venue<input className={inputClass} name="locationName" defaultValue={initial?.locationName ?? ''} placeholder="Required for in-person / hybrid" /></label>
          <label className={labelClass}>Venue address<input className={inputClass} name="locationAddress" defaultValue={initial?.locationAddress ?? ''} /></label>
          <label className={labelClass}>City<input className={inputClass} name="city" defaultValue={initial?.city ?? ''} placeholder="Mumbai" /></label>
          <label className={labelClass}>Country<input className={inputClass} name="country" defaultValue={initial?.country ?? ''} placeholder="India" /></label>
          <label className={`${labelClass} sm:col-span-2`}>Online meeting URL<input className={inputClass} type="url" name="meetingUrl" defaultValue={initial?.meetingUrl ?? ''} placeholder="https://… required for online / hybrid" /></label>
          <label className={`${labelClass} sm:col-span-2`}>Topics<input className={inputClass} name="topics" defaultValue={initial?.topics.join(', ') ?? ''} placeholder="SIRE 2.0, tanker operations, human factors" /><span className="block text-xs font-normal text-muted">Separate multiple topics with commas.</span></label>
          <label className={`${labelClass} sm:col-span-2`}>Agenda<textarea className={`${inputClass} min-h-32`} name="agenda" defaultValue={initial?.agenda.join('\n') ?? ''} placeholder={'09:00 Welcome\n09:15 SIRE 2.0 readiness\n11:30 Q&A'} /><span className="block text-xs font-normal text-muted">One agenda item per line.</span></label>
          <label className={`${labelClass} sm:col-span-2`}>Speaker details<textarea className={`${inputClass} min-h-28`} name="speakerDetails" defaultValue={initial?.speakerDetails.map((speaker) => [speaker.name, speaker.title, speaker.organization].join(' | ')).join('\n') ?? ''} placeholder={'Capt. Name | Master Mariner | Company\nChief Engineer Name | Technical Director | Company'} /><span className="block text-xs font-normal text-muted">One speaker per line: Name | Title | Organization.</span></label>
          <label className={`${labelClass} sm:col-span-2`}>Speaker names only <span className="font-normal text-muted">(optional fallback)</span><input className={inputClass} name="speakers" defaultValue={initial?.speakers.join(', ') ?? ''} placeholder="Capt. Name, Chief Engineer Name" /></label>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Registration & presentation</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>Registration<select className={inputClass} name="registrationMode" defaultValue={initial?.registrationMode ?? 'open'}><option value="open">Open</option><option value="closed">Closed</option></select></label>
          <label className={labelClass}>Registration closes<input className={inputClass} type="datetime-local" name="registrationClosesAt" defaultValue={datetimeLocal(initial?.registrationClosesAt)} /><span className="block text-xs font-normal text-muted">Optional. Must be before the event starts.</span></label>
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-end justify-between gap-3"><div><p className="text-sm font-semibold text-navy-900">Event banner</p><p className="mt-1 text-xs font-normal text-muted">JPEG, PNG or WebP up to 8 MB. A 16:9 image works best.</p></div>{bannerReference ? <button type="button" onClick={removeBanner} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 aria-hidden="true" className="size-3.5" />Remove</button> : null}</div>
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
                <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center"><span className="grid size-11 place-items-center rounded-2xl bg-white text-teal-700 shadow-sm"><ImageUp aria-hidden="true" className="size-5" /></span><span className="mt-3 text-sm font-bold text-navy-950">Upload banner</span><span className="mt-1 text-xs text-muted">Click to choose an image from your device</span>{bannerUploading ? <span className="mt-3 text-xs font-bold text-teal-700">Uploading {bannerProgress}%</span> : null}</div>
              )}
            </label>
          </div>
        </div>
      </section>

      {message ? <p className={`rounded-xl px-4 py-3 text-sm font-semibold ${error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{message}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} type="submit" name="status" value="draft" className="rounded-xl border border-navy-200 bg-white px-5 py-3 text-sm font-bold text-navy-900 disabled:opacity-60">{bannerUploading ? 'Uploading banner…' : pending ? 'Saving…' : initial?.status === 'published' ? 'Unpublish to draft' : 'Save draft'}</button>
        <button disabled={busy} type="submit" name="status" value="published" className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-60">{initial?.status === 'published' ? 'Save & keep published' : 'Publish event'}</button>
        {props.mode === 'edit' ? <button disabled={busy} type="button" onClick={cancelEvent} className="ml-auto rounded-xl border border-rose-200 px-5 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60">Cancel event</button> : null}
      </div>
    </form>
  )
}
