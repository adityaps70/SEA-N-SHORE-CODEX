export type ProfileAvailability = 'onboard' | 'ashore'

export function normalizeProfileAvailability(value: string | null | undefined): ProfileAvailability {
  return value?.trim().toLocaleLowerCase('en') === 'onboard' ? 'onboard' : 'ashore'
}

export function profileAvailabilityLabel(value: string | null | undefined): 'Onboard' | 'Ashore' | null {
  if (!value) return null
  return normalizeProfileAvailability(value) === 'onboard' ? 'Onboard' : 'Ashore'
}
