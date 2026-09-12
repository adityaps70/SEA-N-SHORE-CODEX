import type { QueryResultRow } from 'pg'
import { query, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type {
  CalendarEvent,
  CalendarEventFilters,
  CalendarEventFormat,
  CalendarEventInput,
  CalendarEventStatus,
  CalendarSpeakerDetail,
} from './calendar-types'

type CalendarEventRow = QueryResultRow & {
  id: string
  host_user_id: string
  host_name: string
  host_slug: string | null
  title: string
  summary: string
  description: string
  category: CalendarEvent['category']
  event_type: CalendarEvent['eventType']
  format: CalendarEventFormat
  status: CalendarEventStatus
  start_at: string | Date
  end_at: string | Date
  timezone: string
  location_name: string | null
  location_address: string | null
  city: string | null
  country: string | null
  meeting_url: string | null
  topics: string[] | null
  agenda: unknown
  speakers: string[] | null
  speaker_details: unknown
  capacity: number | null
  banner_url: string | null
  registration_mode: CalendarEvent['registrationMode']
  registration_closes_at: string | Date | null
  attendee_count: string | number
  viewer_is_attending: boolean
  viewer_is_host: boolean
  created_at: string | Date
  updated_at: string | Date
}

type EventLockRow = QueryResultRow & {
  id: string
  host_user_id: string
  status: CalendarEventStatus
  end_at: string | Date
  capacity: number | null
  registration_mode: CalendarEvent['registrationMode']
  registration_closes_at: string | Date | null
}

const EVENT_SELECT = `
  select
    e.id,
    e.host_user_id,
    p.full_name as host_name,
    p.slug as host_slug,
    e.title,
    e.summary,
    e.description,
    e.category,
    e.event_type,
    e.format,
    e.status,
    e.start_at,
    e.end_at,
    e.timezone,
    e.location_name,
    e.location_address,
    e.city,
    e.country,
    case
      when e.host_user_id = $1::uuid
        or exists (
          select 1 from public.event_attendees access_ea
          where access_ea.event_id = e.id and access_ea.user_id = $1::uuid
        )
      then e.meeting_url
      else null
    end as meeting_url,
    e.topics,
    e.agenda,
    e.speakers,
    e.speaker_details,
    e.capacity,
    e.banner_url,
    e.registration_mode,
    e.registration_closes_at,
    (select count(*)::bigint from public.event_attendees count_ea where count_ea.event_id = e.id) as attendee_count,
    exists (
      select 1 from public.event_attendees viewer_ea
      where viewer_ea.event_id = e.id and viewer_ea.user_id = $1::uuid
    ) as viewer_is_attending,
    (e.host_user_id = $1::uuid) as viewer_is_host,
    e.created_at,
    e.updated_at
  from public.events e
  join public.profiles p on p.id = e.host_user_id
`

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function nullableIso(value: string | Date | null) {
  return value ? iso(value) : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function speakerDetails(value: unknown): CalendarSpeakerDetail[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    if (typeof candidate.name !== 'string') return []
    return [{
      name: candidate.name,
      title: typeof candidate.title === 'string' ? candidate.title : '',
      organization: typeof candidate.organization === 'string' ? candidate.organization : '',
    }]
  })
}

function mapEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    hostUserId: row.host_user_id,
    hostName: row.host_name,
    hostSlug: row.host_slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    category: row.category,
    eventType: row.event_type,
    format: row.format,
    status: row.status,
    startAt: iso(row.start_at),
    endAt: iso(row.end_at),
    timezone: row.timezone,
    locationName: row.location_name,
    locationAddress: row.location_address,
    city: row.city,
    country: row.country,
    meetingUrl: row.meeting_url,
    topics: row.topics ?? [],
    agenda: stringList(row.agenda),
    speakers: row.speakers ?? [],
    speakerDetails: speakerDetails(row.speaker_details),
    capacity: row.capacity,
    bannerUrl: row.banner_url,
    registrationMode: row.registration_mode,
    registrationClosesAt: nullableIso(row.registration_closes_at),
    attendeeCount: Number(row.attendee_count ?? 0),
    viewerIsAttending: row.viewer_is_attending,
    viewerIsHost: row.viewer_is_host,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function eventValues(input: CalendarEventInput) {
  return [
    input.title,
    input.summary,
    input.description,
    input.category,
    input.eventType,
    input.format,
    input.status,
    input.startAt,
    input.endAt,
    input.timezone,
    input.locationName,
    input.locationAddress,
    input.city,
    input.country,
    input.meetingUrl,
    input.topics,
    JSON.stringify(input.agenda),
    input.speakers,
    JSON.stringify(input.speakerDetails),
    input.capacity,
    input.bannerUrl,
    input.registrationMode,
    input.registrationClosesAt,
  ] as const
}

function normalizedFilters(filters: CalendarEventFilters | string = '') {
  const normalized = typeof filters === 'string' ? { search: filters } : filters
  return {
    search: (normalized.search ?? '').trim().slice(0, 160),
    category: normalized.category ?? '',
    eventType: normalized.eventType ?? '',
    format: normalized.format ?? '',
    location: (normalized.location ?? '').trim().slice(0, 160),
  }
}

async function rowsForViewer(viewerId: string, whereSql: string, values: readonly unknown[]) {
  const rows = await query<CalendarEventRow>(`${EVENT_SELECT}\n${whereSql}`, [viewerId, ...values])
  return rows.map(mapEvent)
}

async function listDiscoverEvents(viewerId: string, filters: CalendarEventFilters | string = '') {
  const value = normalizedFilters(filters)
  return rowsForViewer(viewerId, `
    where e.status = 'published'
      and e.end_at > now()
      and (
        $2::text = '' or
        e.title ilike ('%' || $2::text || '%') or
        e.summary ilike ('%' || $2::text || '%') or
        e.description ilike ('%' || $2::text || '%') or
        coalesce(e.location_name, '') ilike ('%' || $2::text || '%') or
        coalesce(e.city, '') ilike ('%' || $2::text || '%') or
        coalesce(e.country, '') ilike ('%' || $2::text || '%') or
        exists (select 1 from unnest(e.topics) topic where topic ilike ('%' || $2::text || '%'))
      )
      and ($3::text = '' or e.category = $3::text)
      and ($4::text = '' or e.event_type = $4::text)
      and ($5::text = '' or e.format = $5::text)
      and (
        $6::text = '' or
        coalesce(e.location_name, '') ilike ('%' || $6::text || '%') or
        coalesce(e.location_address, '') ilike ('%' || $6::text || '%') or
        coalesce(e.city, '') ilike ('%' || $6::text || '%') or
        coalesce(e.country, '') ilike ('%' || $6::text || '%')
      )
    order by e.start_at asc
    limit 100
  `, [value.search, value.category, value.eventType, value.format, value.location])
}

async function listMyEvents(userId: string) {
  return rowsForViewer(userId, `
    join public.event_attendees my_ea on my_ea.event_id = e.id and my_ea.user_id = $1::uuid
    where e.end_at > now()
    order by e.start_at asc
    limit 100
  `, [])
}

async function listMyPastEvents(userId: string) {
  return rowsForViewer(userId, `
    join public.event_attendees my_ea on my_ea.event_id = e.id and my_ea.user_id = $1::uuid
    where e.end_at <= now()
    order by e.end_at desc
    limit 100
  `, [])
}

async function listHostedEvents(userId: string) {
  return rowsForViewer(userId, `
    where e.host_user_id = $1::uuid
    order by case when e.end_at > now() then 0 else 1 end, e.start_at asc
    limit 200
  `, [])
}

async function listPastEvents(viewerId: string, filters: CalendarEventFilters | string = '') {
  const value = normalizedFilters(filters)
  return rowsForViewer(viewerId, `
    where e.status in ('published', 'cancelled')
      and e.end_at <= now()
      and ($2::text = '' or e.title ilike ('%' || $2::text || '%') or e.summary ilike ('%' || $2::text || '%'))
      and ($3::text = '' or e.category = $3::text)
      and ($4::text = '' or e.event_type = $4::text)
      and ($5::text = '' or e.format = $5::text)
      and (
        $6::text = '' or
        coalesce(e.location_name, '') ilike ('%' || $6::text || '%') or
        coalesce(e.city, '') ilike ('%' || $6::text || '%') or
        coalesce(e.country, '') ilike ('%' || $6::text || '%')
      )
    order by e.end_at desc
    limit 30
  `, [value.search, value.category, value.eventType, value.format, value.location])
}

async function getEvent(eventId: string, viewerId: string) {
  const rows = await rowsForViewer(viewerId, `
    where e.id = $2::uuid
      and (e.status <> 'draft' or e.host_user_id = $1::uuid)
    limit 1
  `, [eventId])
  return rows[0] ?? null
}

async function createEvent(hostUserId: string, input: CalendarEventInput) {
  const values = eventValues(input)
  const rows = await query<{ id: string } & QueryResultRow>(`
    insert into public.events (
      host_user_id, title, summary, description, category, event_type, format, status, start_at, end_at, timezone,
      location_name, location_address, city, country, meeting_url, topics, agenda, speakers, speaker_details,
      capacity, banner_url, registration_mode, registration_closes_at
    ) values (
      $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::timestamptz, $10::timestamptz, $11::text,
      $12::text, $13::text, $14::text, $15::text, $16::text, $17::text[], $18::jsonb, $19::text[], $20::jsonb,
      $21::integer, $22::text, $23::text, $24::timestamptz
    ) returning id
  `, [hostUserId, ...values])
  const id = rows[0]?.id
  if (!id) throw new Error('event_create_failed')
  return id
}

async function updateEvent(hostUserId: string, eventId: string, input: CalendarEventInput) {
  const values = eventValues(input)
  const rows = await query<{ id: string } & QueryResultRow>(`
    update public.events set
      title=$3::text, summary=$4::text, description=$5::text, category=$6::text, event_type=$7::text,
      format=$8::text, status=$9::text, start_at=$10::timestamptz, end_at=$11::timestamptz, timezone=$12::text,
      location_name=$13::text, location_address=$14::text, city=$15::text, country=$16::text, meeting_url=$17::text,
      topics=$18::text[], agenda=$19::jsonb, speakers=$20::text[], speaker_details=$21::jsonb,
      capacity=$22::integer, banner_url=$23::text, registration_mode=$24::text, registration_closes_at=$25::timestamptz,
      updated_at=now()
    where id=$2::uuid and host_user_id=$1::uuid and status <> 'cancelled'
    returning id
  `, [hostUserId, eventId, ...values])
  if (!rows[0]) throw new Error('event_forbidden')
}

async function cancelEvent(hostUserId: string, eventId: string) {
  const rows = await query<{ id: string } & QueryResultRow>(`
    update public.events
    set status='cancelled', updated_at=now()
    where id=$2::uuid and host_user_id=$1::uuid and status <> 'cancelled'
    returning id
  `, [hostUserId, eventId])
  if (!rows[0]) throw new Error('event_forbidden')
}

async function countAttendees(client: DatabaseQueryClient, eventId: string) {
  const result = await client.query<{ count: string } & QueryResultRow>(
    'select count(*)::bigint as count from public.event_attendees where event_id=$1::uuid',
    [eventId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function attendEvent(userId: string, eventId: string) {
  return withTransaction(async (client) => {
    const result = await client.query<EventLockRow>(`
      select id, host_user_id, status, end_at, capacity, registration_mode, registration_closes_at
      from public.events
      where id=$1::uuid
      for update
    `, [eventId])
    const event = result.rows[0]
    if (!event) throw new Error('event_not_found')
    if (event.host_user_id === userId) throw new Error('event_host_cannot_attend')
    if (event.status !== 'published' || new Date(event.end_at).getTime() <= Date.now()) throw new Error('event_not_open')
    if (event.registration_mode !== 'open') throw new Error('event_not_open')
    if (event.registration_closes_at && new Date(event.registration_closes_at).getTime() <= Date.now()) throw new Error('event_not_open')

    const existing = await client.query<QueryResultRow>(
      'select 1 from public.event_attendees where event_id=$1::uuid and user_id=$2::uuid',
      [eventId, userId],
    )
    if (existing.rows[0]) return

    const attendeeCount = await countAttendees(client, eventId)
    if (event.capacity !== null && attendeeCount >= event.capacity) throw new Error('event_full')

    await client.query(`
      insert into public.event_attendees (event_id, user_id)
      values ($1::uuid, $2::uuid)
      on conflict (event_id, user_id) do nothing
    `, [eventId, userId])
  })
}

async function withdrawAttendance(userId: string, eventId: string) {
  await query('delete from public.event_attendees where event_id=$1::uuid and user_id=$2::uuid', [eventId, userId])
}

export const calendarEventRepository = {
  listDiscoverEvents,
  listMyEvents,
  listMyPastEvents,
  listHostedEvents,
  listPastEvents,
  getEvent,
  createEvent,
  updateEvent,
  cancelEvent,
  attendEvent,
  withdrawAttendance,
}
