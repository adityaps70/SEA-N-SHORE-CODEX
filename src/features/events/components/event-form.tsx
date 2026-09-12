'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelEventAction, createEventAction, updateEventAction } from '../calendar-actions'
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

type Props =
  | { mode: 'create'; initial?: never; eventId?: never }
  | { mode: 'edit'; initial: CalendarEvent; eventId: string }

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-navy-950 outline-none transition placeholder:text-muted focus:border-navy-300 focus:ring-2 focus:ring-navy-100'
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

  function submit(data: FormData) {
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
          <label className={`${labelClass} sm:col-span-2`}>Banner image URL<input className={inputClass} type="url" name="bannerUrl" defaultValue={initial?.bannerUrl ?? ''} placeholder="Optional https://… public or signed display URL" /><span className="block text-xs font-normal text-muted">Use a public or signed display URL; never paste a private storage key.</span></label>
        </div>
      </section>

      {message ? <p className={`rounded-xl px-4 py-3 text-sm font-semibold ${error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{message}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button disabled={pending} type="submit" name="status" value="draft" className="rounded-xl border border-navy-200 bg-white px-5 py-3 text-sm font-bold text-navy-900 disabled:opacity-60">{pending ? 'Saving…' : initial?.status === 'published' ? 'Unpublish to draft' : 'Save draft'}</button>
        <button disabled={pending} type="submit" name="status" value="published" className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-60">{initial?.status === 'published' ? 'Save & keep published' : 'Publish event'}</button>
        {props.mode === 'edit' ? <button disabled={pending} type="button" onClick={cancelEvent} className="ml-auto rounded-xl border border-rose-200 px-5 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60">Cancel event</button> : null}
      </div>
    </form>
  )
}
