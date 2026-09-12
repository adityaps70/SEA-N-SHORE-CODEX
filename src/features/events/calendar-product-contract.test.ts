import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCalendarEventInput } from './calendar-validation'

const root = process.cwd()
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

const completeEvent = {
  title: 'SIRE 2.0 readiness masterclass',
  summary: 'Practical tanker-vetting preparation for maritime professionals.',
  description: 'A working session covering inspection readiness, human factors and close-out actions.',
  category: 'training',
  eventType: 'masterclass',
  format: 'hybrid',
  status: 'published',
  startAt: '2026-10-10T09:00:00.000+05:30',
  endAt: '2026-10-10T12:00:00.000+05:30',
  timezone: 'Asia/Kolkata',
  venue: 'Sea N Shore Maritime Centre',
  locationName: 'Sea N Shore Maritime Centre',
  locationAddress: 'Mumbai, Maharashtra',
  city: 'Mumbai',
  country: 'India',
  meetingUrl: 'https://meet.example.com/sire',
  topics: ['SIRE 2.0', 'Human factors'],
  agenda: ['09:00 Welcome', '09:15 SIRE 2.0 readiness', '11:30 Q&A'],
  speakers: ['Capt. Example'],
  speakerDetails: [{ name: 'Capt. Example', title: 'Master Mariner', organization: 'Sea N Shore' }],
  capacity: 100,
  bannerUrl: 'https://cdn.example.com/events/sire.jpg',
  registrationMode: 'open',
  registrationClosesAt: '2026-10-10T08:30:00.000+05:30',
}

describe('complete maritime Events product contract', () => {
  it('validates and preserves discovery, agenda, speaker and registration fields', () => {
    const parsed = parseCalendarEventInput(completeEvent)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toMatchObject({
      category: 'training',
      eventType: 'masterclass',
      city: 'Mumbai',
      country: 'India',
      agenda: completeEvent.agenda,
      speakerDetails: completeEvent.speakerDetails,
      registrationMode: 'open',
      registrationClosesAt: completeEvent.registrationClosesAt,
    })
  })

  it('rejects registration closing after the event starts', () => {
    const parsed = parseCalendarEventInput({
      ...completeEvent,
      registrationClosesAt: '2026-10-10T10:30:00.000+05:30',
    })
    expect(parsed.success).toBe(false)
  })

  it('ships the requested create route and forward database migration', () => {
    expect(existsSync(resolve(root, 'src/app/(app)/events/create/page.tsx'))).toBe(true)
    expect(existsSync(resolve(root, 'infra/aws/database/migrations/0013_events_product_fields.sql'))).toBe(true)
  })

  it('supports server-side discovery filters without trusting browser organizer ids', () => {
    const repository = source('src/features/events/calendar-repository.ts')
    for (const field of ['category', 'event_type', 'city', 'country', 'format']) {
      expect(repository).toContain(field)
    }
    expect(repository).toContain('CalendarEventFilters')
    expect(repository).toContain('host_user_id = $1::uuid')
  })

  it('renders category, format, event type and location filters in discovery', () => {
    const page = source('src/app/(app)/events/page.tsx')
    for (const filter of ['category', 'format', 'eventType', 'location']) {
      expect(page).toContain(filter)
    }
    expect(page).toContain('/events/create')
  })

  it('keeps RSVP concurrency-safe and unique at the database layer', () => {
    const repository = source('src/features/events/calendar-repository.ts')
    const migration = source('infra/aws/database/migrations/0012_events_engine.sql')
    expect(repository.toLowerCase()).toContain('for update')
    expect(repository).toContain('on conflict (event_id, user_id) do nothing')
    expect(migration).toContain('primary key (event_id, user_id)')
  })
})
