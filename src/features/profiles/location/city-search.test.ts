import { describe, expect, it } from 'vitest'
import { CITY_OPTIONS, findCityOption, normaliseLocation, searchCities } from './city-search'

describe('offline city search (Round H, H7)', () => {
  it('holds a few hundred unique cities with countries', () => {
    expect(CITY_OPTIONS.length).toBeGreaterThanOrEqual(300)
    expect(CITY_OPTIONS.length).toBeLessThanOrEqual(800)
    const labels = CITY_OPTIONS.map((option) => option.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toEqual(expect.arrayContaining(['Mumbai, India', 'Singapore', 'Piraeus, Greece', 'Rotterdam, Netherlands']))
  })

  it('normalises accents, case and punctuation', () => {
    expect(normaliseLocation('  Ålesund ')).toBe('alesund')
    expect(normaliseLocation('St. John’s')).toBe('st john s')
  })

  it('ranks city-name prefixes first and Indian cities ahead on ties', () => {
    expect(searchCities('mum')[0]?.label).toBe('Mumbai, India')
    expect(searchCities('Singapore')[0]?.label).toBe('Singapore')
    expect(searchCities('alesund')[0]?.label).toBe('Ålesund, Norway')
    expect(searchCities('greece').every((option) => option.country === 'Greece')).toBe(true)
    expect(searchCities('Cartagena').map((option) => option.label)).toEqual(['Cartagena, Colombia', 'Cartagena, Spain'])
  })

  it('limits results and ignores an empty query', () => {
    expect(searchCities('a')).toHaveLength(8)
    expect(searchCities('a', 3)).toHaveLength(3)
    expect(searchCities('   ')).toEqual([])
    expect(searchCities('zzzz')).toEqual([])
  })

  it('recognises stored "City, Country" values and leaves free text alone', () => {
    expect(findCityOption('mumbai, india')).toEqual({ city: 'Mumbai', country: 'India', label: 'Mumbai, India' })
    expect(findCityOption('Andheri East, Mumbai')).toBeNull()
    expect(findCityOption('')).toBeNull()
  })
})
