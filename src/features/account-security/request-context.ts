import { trustedClientIp } from '@/lib/http/client-ip'
import { summarizeUserAgent } from './user-agent'

/**
 * Round H (H3): what a new session row records about the request. The city and country come from CloudFront's
 * viewer headers, which the edge forwards to the app (the default behaviour uses the managed
 * AllViewerExceptHostHeader origin request policy, which includes CloudFront-Viewer-City and
 * CloudFront-Viewer-Country). CloudFront sets these itself, so a browser cannot supply them. Without them nothing
 * is stored and the page says "Location unavailable". No paid geo-IP service is used.
 */
export type SessionRequestContext = {
  userAgentSummary: string | null
  city: string | null
  country: string | null
  ip: string | null
}

type HeaderSource = Pick<Headers, 'get'>

function cleanCity(value: string | null) {
  if (!value) return null
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // Keep the raw value; it is checked below.
  }
  const city = decoded.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim()
  return city.length >= 1 && city.length <= 80 ? city : null
}

function cleanCountry(value: string | null) {
  const country = value?.trim().toUpperCase() ?? ''
  return /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null
}

export function sessionRequestContext(headers: HeaderSource): SessionRequestContext {
  return {
    userAgentSummary: summarizeUserAgent(headers.get('user-agent')).summary,
    city: cleanCity(headers.get('cloudfront-viewer-city')),
    country: cleanCountry(headers.get('cloudfront-viewer-country')),
    ip: trustedClientIp(headers),
  }
}

/** "Mumbai, India", "India", or null when the edge sent no location. */
export function approximateLocation(city: string | null, country: string | null, locale = 'en') {
  let countryName: string | null = null
  if (country) {
    try {
      countryName = new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country
    } catch {
      countryName = country
    }
  }
  if (city && countryName) return `${city}, ${countryName}`
  return countryName ?? city ?? null
}
