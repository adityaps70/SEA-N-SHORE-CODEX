import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('Events create and discovery UX contract', () => {
  it('uses a large custom date picker with a separate time control', () => {
    const pickerPath = 'src/features/events/components/event-date-time-field.tsx'
    expect(existsSync(resolve(root, pickerPath))).toBe(true)
    if (!existsSync(resolve(root, pickerPath))) return

    const picker = source(pickerPath)
    const form = source('src/features/events/components/event-form.tsx')
    expect(picker).toContain('CalendarDays')
    expect(picker).toContain('Clock3')
    expect(picker).toContain('grid-cols-7')
    expect(picker).toContain('type="time"')
    expect(picker).toContain('w-[min(22rem,calc(100vw-3rem))]')
    expect(form).toContain('EventDateTimeField')
    expect(form).not.toContain('type="datetime-local"')
  })

  it('offers a real timezone selector instead of free text', () => {
    const form = source('src/features/events/components/event-form.tsx')
    const zonesPath = 'src/features/events/event-timezones.ts'
    expect(existsSync(resolve(root, zonesPath))).toBe(true)
    if (!existsSync(resolve(root, zonesPath))) return

    const zones = source(zonesPath)
    expect(zones).toContain('Asia/Kolkata')
    expect(zones).toContain('Asia/Singapore')
    expect(zones).toContain('Asia/Dubai')
    expect(zones).toContain('Europe/London')
    expect(form).toContain('EVENT_TIMEZONES')
    expect(form).toContain('name="timezone"')
    expect(form).not.toContain('Use an IANA timezone')
  })

  it('shows only location fields relevant to the chosen event format', () => {
    const form = source('src/features/events/components/event-form.tsx')
    expect(form).toContain('setFormat')
    expect(form).toContain("format !== 'online'")
    expect(form).toContain("format !== 'in_person'")
    expect(form).toContain('Where it happens')
  })

  it('uses calmer placeholders and roomier premium controls', () => {
    const form = source('src/features/events/components/event-form.tsx')
    const events = source('src/app/(app)/events/page.tsx')
    expect(form).toContain('placeholder:text-slate-400')
    expect(form).toContain('placeholder:font-normal')
    expect(form).toContain('min-h-12')
    expect(events).toContain('appearance-none')
    expect(events).toContain('rounded-2xl')
    expect(events).toContain('min-h-12')
  })
})
