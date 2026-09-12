import type { QueryResultRow } from 'pg'
import { query, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type { CalendarEvent, CalendarEventFormat, CalendarEventInput, CalendarEventStatus } from './calendar-types'

type CalendarEventRow = QueryResultRow & {
  id: string
  host_user_id: string
  host_name: string
  host_slug: string | null
  title: string
  summary: string
  description: string
  format: CalendarEventFormat
  status: CalendarEventStatus
  start_at: string | Date
  end_at: string | Date
  timezone: string
  location_name: string | null
  location_address: string | null
  meeting_url: string | null
  topics: string[] | null
  speakers: string[] | null
  capacity: number | null
  banner_url: string | null
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
    e.format,
    e.status,
    e.start_at,
    e.end_at,
    e.timezone,
    e.location_name,
    e.location_address,
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
    e.speakers,
    e.capacity,
    e.banner_url,
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

function mapEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    hostUserId: row.host_user_id,
    hostName: row.host_name,
    hostSlug: row.host_slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    format: row.format,
    status: row.status,
    startAt: iso(row.start_at),
    endAt: iso(row.end_at),
    timezone: row.timezone,
    locationName: row.location_name,
    locationAddress: row.location_address,
    meetingUrl: row.meeting_url,
    topics: row.topics ?? [],
    speakers: row.speakers ?? [],
    capacity: row.capacity,
    bannerUrl: row.banner_url,
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
    input.format,
    input.status,
    input.startAt,
    input.endAt,
    input.timezone,
    input.locationName,
    input.locationAddress,
    input.meetingUrl,
    input.topics,
    input.speakers,
    input.capacity,
    input.bannerUrl,
  ] as const
}

async function rowsForViewer(viewerId: string, whereSql: string, values: readonly unknown[]) {
  const rows = await query<CalendarEventRow>(`${EVENT_SELECT}\n${whereSql}`, [viewerId, ...values])
  return rows.map(mapEvent)
}

async function listDiscoverEvents(viewerId: string, search = '') {
  const normalized = search.trim().slice(0, 160)
  return rowsForViewer(viewerId, `
    where e.status = 'published'
      and e.end_at > now()
      and (
        $2::text = '' or
        e.title ilike ('%' || $2::text || '%') or
        e.summary ilike ('%' || $2::text || '%') or
        e.description ilike ('%' || $2::text || '%') or
        coalesce(e.location_name, '') ilike ('%' || $2::text || '%') or
        exists (select 1 from unnest(e.topics) topic where topic ilike ('%' || $2::text || '%'))
      )
    order by e.start_at asc
    limit 100
  `, [normalized])
}

async function listMyEvents(userId: string) {
  return rowsForViewer(userId, `
    join public.event_attendees my_ea on my_ea.event_id = e.id and my_ea.user_id = $1::uuid
    where e.end_at > now()
    order by e.start_at asc
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

async function listPastEvents(viewerId: string, search = '') {
  const normalized = search.trim().slice(0, 160)
  return rowsForViewer(viewerId, `
    where e.status in ('published', 'cancelled')
      and e.end_at <= now()
      and ($2::text = '' or e.title ilike ('%' || $2::text || '%') or e.summary ilike ('%' || $2::text || '%'))
    order by e.end_at desc
    limit 30
  `, [normalized])
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
      host_user_id, title, summary, description, format, status, start_at, end_at, timezone,
      location_name, location_address, meeting_url, topics, speakers, capacity, banner_url
    ) values (
      $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::timestamptz, $8::timestamptz, $9::text,
      $10::text, $11::text, $12::text, $13::text[], $14::text[], $15::integer, $16::text
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
      title=$3::text, summary=$4::text, description=$5::text, format=$6::text, status=$7::text,
      start_at=$8::timestamptz, end_at=$9::timestamptz, timezone=$10::text,
      location_name=$11::text, location_address=$12::text, meeting_url=$13::text,
      topics=$14::text[], speakers=$15::text[], capacity=$16::integer, banner_url=$17::text, updated_at=now()
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
      select id, host_user_id, status, end_at, capacity
      from public.events
      where id=$1::uuid
      for update
    `, [eventId])
    const event = result.rows[0]
    if (!event) throw new Error('event_not_found')
    if (event.host_user_id === userId) throw new Error('event_host_cannot_attend')
    if (event.status !== 'published' || new Date(event.end_at).getTime() <= Date.now()) throw new Error('event_not_open')

    const attendeeCount = await countAttendees(client, eventId)
    if (event.capacity !== null && attendeeCount >= event.capacity) {
      const existing = await client.query<QueryResultRow>(
        'select 1 from public.event_attendees where event_id=$1::uuid and user_id=$2::uuid',
        [eventId, userId],
      )
      if (!existing.rows[0]) throw new Error('event_full')
    }

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
  listHostedEvents,
  listPastEvents,
  getEvent,
  createEvent,
  updateEvent,
  cancelEvent,
  attendEvent,
  withdrawAttendance,
}
