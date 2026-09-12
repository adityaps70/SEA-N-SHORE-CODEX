import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

const requiredFiles = [
  'src/features/events/calendar-types.ts',
  'src/features/events/calendar-validation.ts',
  'src/features/events/calendar-repository.ts',
  'src/features/events/calendar-actions.ts',
  'src/features/events/components/event-form.tsx',
  'src/features/events/components/event-card.tsx',
  'src/features/events/components/event-nav.tsx',
  'src/features/events/components/attendance-control.tsx',
  'src/app/(app)/events/new/page.tsx',
  'src/app/(app)/events/my/page.tsx',
  'src/app/(app)/events/hosting/page.tsx',
  'src/app/(app)/events/[eventId]/page.tsx',
  'src/app/(app)/events/[eventId]/edit/page.tsx',
]

describe('maritime events engine source contract', () => {
  it('ships the complete event product surface', () => {
    for (const file of requiredFiles) expect(existsSync(resolve(root, file)), file).toBe(true)
  })

  it('authenticates every mutation on the server and supports create, edit, cancel and attendance', () => {
    const actions = source('src/features/events/calendar-actions.ts')
    expect(actions).toContain("'use server'")
    expect(actions).toContain('requireAwsUser')
    for (const operation of [
      'createEventAction',
      'updateEventAction',
      'cancelEventAction',
      'attendEventAction',
      'withdrawEventAttendanceAction',
    ]) expect(actions).toContain(operation)
  })

  it('keeps event persistence and authorization in a dedicated repository', () => {
    const repository = source('src/features/events/calendar-repository.ts')
    for (const operation of [
      'listDiscoverEvents',
      'listMyEvents',
      'listHostedEvents',
      'listPastEvents',
      'getEvent',
      'createEvent',
      'updateEvent',
      'cancelEvent',
      'attendEvent',
      'withdrawAttendance',
    ]) expect(repository).toContain(operation)
    expect(repository).toContain('event_attendees')
    expect(repository).toContain('host_user_id')
  })
})
