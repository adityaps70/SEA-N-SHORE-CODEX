import { CITIES_BY_COUNTRY } from './city-data'

/** Round H (H7): searching the offline city list for the profile location picker. Client-safe. */
export type CityOption = { city: string; country: string; label: string }

export const CITY_OPTIONS: readonly CityOption[] = Object.entries(CITIES_BY_COUNTRY).flatMap(([country, cities]) =>
  cities.map((city) => ({ city, country, label: city === country ? city : `${city}, ${country}` })))

/** Lowercase, without accents or punctuation, single spaces: "Ålesund" → "alesund". */
export function normaliseLocation(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const INDEX = CITY_OPTIONS.map((option) => ({
  option,
  city: normaliseLocation(option.city),
  country: normaliseLocation(option.country),
  label: normaliseLocation(option.label),
}))

/** Best matches first: city starts with the query, then a word of it does, then the full label contains it. */
export function searchCities(query: string, limit = 8): CityOption[] {
  const needle = normaliseLocation(query)
  if (!needle) return []
  const scored: { option: CityOption; score: number }[] = []
  for (const entry of INDEX) {
    let score = 0
    if (entry.city === needle || entry.label === needle) score = 100
    else if (entry.city.startsWith(needle)) score = 80
    else if (entry.label.startsWith(needle)) score = 70
    else if (entry.city.split(' ').some((word) => word.startsWith(needle))) score = 60
    else if (entry.country.startsWith(needle)) score = 40
    else if (needle.length >= 3 && entry.label.includes(needle)) score = 20
    if (score) scored.push({ option: entry.option, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || (a.option.country === 'India' ? -1 : 0) - (b.option.country === 'India' ? -1 : 0) || a.option.label.localeCompare(b.option.label))
    .slice(0, limit)
    .map((entry) => entry.option)
}

/** The list entry a stored location matches ("mumbai, india" → Mumbai, India), or null for free text. */
export function findCityOption(value: string | null | undefined): CityOption | null {
  const needle = normaliseLocation(value ?? '')
  if (!needle) return null
  return INDEX.find((entry) => entry.label === needle)?.option ?? null
}
