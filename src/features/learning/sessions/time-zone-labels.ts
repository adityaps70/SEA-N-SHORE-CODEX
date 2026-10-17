import { timeZoneOptions, zoneOffsetMinutes } from './session-time'

/**
 * Round H (H7): friendly labels for the time-zone picker, e.g. "Kolkata, India (UTC+5:30)", sorted by the zone's
 * current offset (so daylight saving shows the offset in force today). The stored value stays the IANA name.
 * Pure Intl plus an offline country list; safe in the browser and on the server.
 */

/** Countries of the zones members pick most; other zones show their region ("Thule, America"). */
const ZONE_COUNTRIES: Readonly<Record<string, string>> = {
  'Asia/Kolkata': 'India', 'Asia/Calcutta': 'India', 'Asia/Dubai': 'United Arab Emirates', 'Asia/Singapore': 'Singapore',
  'Asia/Manila': 'Philippines', 'Asia/Dhaka': 'Bangladesh', 'Asia/Colombo': 'Sri Lanka', 'Asia/Karachi': 'Pakistan',
  'Asia/Kathmandu': 'Nepal', 'Indian/Maldives': 'Maldives', 'Asia/Yangon': 'Myanmar', 'Asia/Riyadh': 'Saudi Arabia',
  'Asia/Qatar': 'Qatar', 'Asia/Muscat': 'Oman', 'Asia/Bahrain': 'Bahrain', 'Asia/Kuwait': 'Kuwait', 'Asia/Tehran': 'Iran',
  'Asia/Baghdad': 'Iraq', 'Asia/Amman': 'Jordan', 'Asia/Jerusalem': 'Israel', 'Asia/Beirut': 'Lebanon',
  'Europe/Istanbul': 'Turkey', 'Asia/Nicosia': 'Cyprus', 'Africa/Cairo': 'Egypt', 'Asia/Kuala_Lumpur': 'Malaysia',
  'Asia/Kuching': 'Malaysia', 'Asia/Jakarta': 'Indonesia', 'Asia/Makassar': 'Indonesia', 'Asia/Jayapura': 'Indonesia',
  'Asia/Bangkok': 'Thailand', 'Asia/Ho_Chi_Minh': 'Vietnam', 'Asia/Phnom_Penh': 'Cambodia', 'Asia/Shanghai': 'China',
  'Asia/Hong_Kong': 'Hong Kong', 'Asia/Taipei': 'Taiwan', 'Asia/Seoul': 'South Korea', 'Asia/Tokyo': 'Japan',
  'Asia/Vladivostok': 'Russia', 'Asia/Tbilisi': 'Georgia', 'Asia/Baku': 'Azerbaijan', 'Asia/Yerevan': 'Armenia',
  'Asia/Tashkent': 'Uzbekistan', 'Asia/Almaty': 'Kazakhstan', 'Asia/Kabul': 'Afghanistan', 'Asia/Thimphu': 'Bhutan',
  'Australia/Sydney': 'Australia', 'Australia/Melbourne': 'Australia', 'Australia/Brisbane': 'Australia',
  'Australia/Perth': 'Australia', 'Australia/Adelaide': 'Australia', 'Australia/Darwin': 'Australia', 'Australia/Hobart': 'Australia',
  'Pacific/Auckland': 'New Zealand', 'Pacific/Port_Moresby': 'Papua New Guinea', 'Pacific/Fiji': 'Fiji', 'Pacific/Honolulu': 'United States',
  'Europe/London': 'United Kingdom', 'Europe/Dublin': 'Ireland', 'Europe/Oslo': 'Norway', 'Europe/Copenhagen': 'Denmark',
  'Europe/Stockholm': 'Sweden', 'Europe/Helsinki': 'Finland', 'Atlantic/Reykjavik': 'Iceland', 'Europe/Berlin': 'Germany',
  'Europe/Amsterdam': 'Netherlands', 'Europe/Brussels': 'Belgium', 'Europe/Paris': 'France', 'Europe/Madrid': 'Spain',
  'Atlantic/Canary': 'Spain', 'Europe/Lisbon': 'Portugal', 'Europe/Rome': 'Italy', 'Europe/Malta': 'Malta',
  'Europe/Athens': 'Greece', 'Europe/Zagreb': 'Croatia', 'Europe/Bucharest': 'Romania', 'Europe/Sofia': 'Bulgaria',
  'Europe/Kyiv': 'Ukraine', 'Europe/Kiev': 'Ukraine', 'Europe/Moscow': 'Russia', 'Europe/Warsaw': 'Poland',
  'Europe/Vilnius': 'Lithuania', 'Europe/Riga': 'Latvia', 'Europe/Tallinn': 'Estonia', 'Europe/Zurich': 'Switzerland',
  'Europe/Monaco': 'Monaco', 'Europe/Vienna': 'Austria', 'Europe/Prague': 'Czechia', 'Europe/Budapest': 'Hungary',
  'Europe/Belgrade': 'Serbia', 'Europe/Ljubljana': 'Slovenia', 'Europe/Podgorica': 'Montenegro',
  'America/New_York': 'United States', 'America/Chicago': 'United States', 'America/Denver': 'United States',
  'America/Phoenix': 'United States', 'America/Los_Angeles': 'United States', 'America/Anchorage': 'United States',
  'America/Toronto': 'Canada', 'America/Vancouver': 'Canada', 'America/Halifax': 'Canada', 'America/St_Johns': 'Canada',
  'America/Winnipeg': 'Canada', 'America/Edmonton': 'Canada', 'America/Mexico_City': 'Mexico', 'America/Panama': 'Panama',
  'America/Sao_Paulo': 'Brazil', 'America/Argentina/Buenos_Aires': 'Argentina', 'America/Santiago': 'Chile',
  'America/Lima': 'Peru', 'America/Bogota': 'Colombia', 'America/Montevideo': 'Uruguay', 'America/Guayaquil': 'Ecuador',
  'America/Caracas': 'Venezuela', 'America/Port_of_Spain': 'Trinidad and Tobago', 'America/Jamaica': 'Jamaica',
  'America/Nassau': 'Bahamas', 'Africa/Johannesburg': 'South Africa', 'Africa/Lagos': 'Nigeria', 'Africa/Accra': 'Ghana',
  'Africa/Nairobi': 'Kenya', 'Africa/Dar_es_Salaam': 'Tanzania', 'Africa/Maputo': 'Mozambique', 'Africa/Casablanca': 'Morocco',
  'Africa/Algiers': 'Algeria', 'Africa/Tunis': 'Tunisia', 'Africa/Djibouti': 'Djibouti', 'Africa/Luanda': 'Angola',
  'Africa/Dakar': 'Senegal', 'Africa/Abidjan': 'Ivory Coast', 'Africa/Douala': 'Cameroon', 'Indian/Mauritius': 'Mauritius',
  'Indian/Mahe': 'Seychelles', 'Indian/Antananarivo': 'Madagascar', 'Africa/Windhoek': 'Namibia', 'Africa/Addis_Ababa': 'Ethiopia',
}

export type TimeZoneChoice = {
  /** The IANA name that is stored, e.g. "Asia/Kolkata". */
  value: string
  /** "Kolkata, India (UTC+5:30)". */
  label: string
  offsetMinutes: number
  /** Lowercased words the search matches: label, IANA name and offset. */
  search: string
}

/** "UTC", "UTC+5:30", "UTC-3", "UTC+5:45". */
export function formatUtcOffset(minutes: number) {
  if (!minutes) return 'UTC'
  const sign = minutes > 0 ? '+' : '-'
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const rest = absolute % 60
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}

/** "Asia/Kolkata" → "Kolkata"; "America/Argentina/Buenos_Aires" → "Buenos Aires". */
function zoneCity(zone: string) {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
}

/** "Kolkata, India (UTC+5:30)" with the offset in force at `at`; "Coordinated Universal Time (UTC)" for UTC. */
export function timeZoneLabel(zone: string, at = new Date()) {
  if (zone === 'UTC' || zone === 'Etc/UTC') return 'Coordinated Universal Time (UTC)'
  let offset = 0
  try {
    offset = zoneOffsetMinutes(at, zone)
  } catch {
    return zone
  }
  const country = ZONE_COUNTRIES[zone]
  const region = zone.includes('/') ? zone.split('/')[0]!.replace(/_/g, ' ') : null
  const place = country ? `${zoneCity(zone)}, ${country}` : region ? `${zoneCity(zone)}, ${region}` : zoneCity(zone)
  return `${place} (${formatUtcOffset(offset)})`
}

/** Every zone with its label, sorted by today's offset (west to east), then by label. */
export function timeZoneChoices(at = new Date(), zones: readonly string[] = timeZoneOptions()): TimeZoneChoice[] {
  return zones
    .flatMap((zone) => {
      let offsetMinutes = 0
      try {
        offsetMinutes = zone === 'UTC' ? 0 : zoneOffsetMinutes(at, zone)
      } catch {
        return []
      }
      const label = timeZoneLabel(zone, at)
      const offset = formatUtcOffset(offsetMinutes)
      return [{ value: zone, label, offsetMinutes, search: `${label} ${zone.replace(/_/g, ' ')} ${offset} ${offset.replace('UTC', 'GMT')}`.toLowerCase() }]
    })
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label))
}

/** Choices whose label, IANA name or offset contain every word of the query ("india", "kolkata", "+5:30"). */
export function filterTimeZones(choices: readonly TimeZoneChoice[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...choices]
  return choices.filter((choice) => words.every((word) => choice.search.includes(word)))
}
