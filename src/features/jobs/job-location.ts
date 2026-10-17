/**
 * Round H (H7): what kind of place a location field names. Job and organization locations are free
 * text, so "Remote", "Worldwide" and "Onboard" sit next to real cities ("Andheri East, Mumbai").
 */
export type LocationKind = 'remote' | 'worldwide' | 'onboard' | 'place'

const REMOTE = /^(?:fully\s+)?(?:remote|remote work|work from home|wfh|telecommute|anywhere|home based|home-based)$/i
const WORLDWIDE = /^(?:worldwide|world wide|world-wide|global|globally|international|various|multiple locations|all over the world)$/i
const ONBOARD = /^(?:onboard|on board|on-board|at sea|offshore|on vessel|onboard vessel|vessel)$/i

export function locationKind(value: string | null | undefined): LocationKind | null {
  const text = (value ?? '').trim().replace(/[.!]+$/, '').replace(/\s+/g, ' ')
  if (!text) return null
  if (REMOTE.test(text)) return 'remote'
  if (WORLDWIDE.test(text)) return 'worldwide'
  if (ONBOARD.test(text)) return 'onboard'
  return 'place'
}

/**
 * The employer line on job cards: "Employer based in Dubai", but "Remote employer",
 * "Employer operating worldwide" and "Sea-based employer" instead of "Employer based in Remote".
 */
export function companyLocationSentence(location: string | null | undefined): string | null {
  const kind = locationKind(location)
  if (kind === null) return null
  if (kind === 'remote') return 'Remote employer'
  if (kind === 'worldwide') return 'Employer operating worldwide'
  if (kind === 'onboard') return 'Sea-based employer'
  return `Employer based in ${location!.trim()}`
}
