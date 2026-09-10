import { describe, expect, it } from 'vitest'

type RelativeTimeModule = {
  relativeTimeFrom?: (timestamp: string, now?: number) => string
}

async function loadRelativeTimeFrom() {
  const modulePath = './relative-time'
  const module = await import(/* @vite-ignore */ modulePath).catch(() => ({} as RelativeTimeModule))
  return (module as RelativeTimeModule).relativeTimeFrom
}

describe('relativeTimeFrom', () => {
  it('formats recent ages deterministically and clamps small future skew to just now', async () => {
    const relativeTimeFrom = await loadRelativeTimeFrom()
    const now = Date.parse('2026-09-10T09:29:00.000Z')
    const actual = relativeTimeFrom
      ? [
          relativeTimeFrom('2026-09-10T09:28:30.000Z', now),
          relativeTimeFrom('2026-09-10T09:27:00.000Z', now),
          relativeTimeFrom('2026-09-10T08:44:00.000Z', now),
          relativeTimeFrom('2026-09-10T06:29:00.000Z', now),
          relativeTimeFrom('2026-09-08T09:29:00.000Z', now),
          relativeTimeFrom('2026-09-10T09:29:20.000Z', now),
        ]
      : []

    expect(actual).toEqual(['just now', '2m', '45m', '3h', '2d', 'just now'])
  })

  it('uses compact UTC dates for items older than a week and includes the year when needed', async () => {
    const relativeTimeFrom = await loadRelativeTimeFrom()
    const now = Date.parse('2026-09-10T09:29:00.000Z')
    const actual = relativeTimeFrom
      ? [
          relativeTimeFrom('2026-09-02T10:00:00.000Z', now),
          relativeTimeFrom('2025-12-31T23:00:00.000Z', now),
        ]
      : []

    expect(actual).toEqual(['2 Sep', '31 Dec 2025'])
  })
})
