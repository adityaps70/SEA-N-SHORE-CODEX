import { describe, expect, it } from 'vitest'
import { filterTimeZones, formatUtcOffset, timeZoneChoices, timeZoneLabel } from './time-zone-labels'

const winter = new Date('2026-01-15T12:00:00Z')
const summer = new Date('2026-07-15T12:00:00Z')

describe('time-zone labels (Round H, H7)', () => {
  it('formats UTC offsets', () => {
    expect(formatUtcOffset(0)).toBe('UTC')
    expect(formatUtcOffset(330)).toBe('UTC+5:30')
    expect(formatUtcOffset(345)).toBe('UTC+5:45')
    expect(formatUtcOffset(-180)).toBe('UTC-3')
    expect(formatUtcOffset(-570)).toBe('UTC-9:30')
    expect(formatUtcOffset(60)).toBe('UTC+1')
  })

  it('labels zones with city, country and the current offset', () => {
    expect(timeZoneLabel('Asia/Kolkata', winter)).toBe('Kolkata, India (UTC+5:30)')
    expect(timeZoneLabel('Asia/Dubai', winter)).toBe('Dubai, United Arab Emirates (UTC+4)')
    expect(timeZoneLabel('UTC', winter)).toBe('Coordinated Universal Time (UTC)')
    expect(timeZoneLabel('America/Argentina/Buenos_Aires', winter)).toBe('Buenos Aires, Argentina (UTC-3)')
  })

  it('shows the offset in force on the day, so daylight saving is right', () => {
    expect(timeZoneLabel('Europe/London', winter)).toBe('London, United Kingdom (UTC)')
    expect(timeZoneLabel('Europe/London', summer)).toBe('London, United Kingdom (UTC+1)')
    expect(timeZoneLabel('Europe/Athens', summer)).toBe('Athens, Greece (UTC+3)')
  })

  it('falls back to the region for zones without a listed country', () => {
    expect(timeZoneLabel('Antarctica/Troll', winter)).toMatch(/^Troll, Antarctica \(UTC/)
  })

  it('sorts choices by offset and keeps the IANA name as the value', () => {
    const choices = timeZoneChoices(winter, ['Asia/Kolkata', 'UTC', 'America/New_York', 'Asia/Tokyo'])
    expect(choices.map((choice) => choice.value)).toEqual(['America/New_York', 'UTC', 'Asia/Kolkata', 'Asia/Tokyo'])
    expect(choices.map((choice) => choice.offsetMinutes)).toEqual([-300, 0, 330, 540])
  })

  it('finds zones by country, city, IANA name or offset', () => {
    const choices = timeZoneChoices(winter, ['Asia/Kolkata', 'Asia/Colombo', 'Europe/London', 'Asia/Kathmandu'])
    expect(filterTimeZones(choices, 'india').map((choice) => choice.value)).toEqual(['Asia/Kolkata'])
    expect(filterTimeZones(choices, '+5:30').map((choice) => choice.value)).toEqual(['Asia/Colombo', 'Asia/Kolkata'])
    expect(filterTimeZones(choices, 'asia/kath').map((choice) => choice.value)).toEqual(['Asia/Kathmandu'])
    expect(filterTimeZones(choices, 'gmt+5:45').map((choice) => choice.value)).toEqual(['Asia/Kathmandu'])
    expect(filterTimeZones(choices, '')).toHaveLength(4)
  })

  it('covers every zone the runtime knows', () => {
    expect(timeZoneChoices(winter).length).toBeGreaterThan(300)
  })
})
