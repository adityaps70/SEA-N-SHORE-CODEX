import type { Capability } from './policy'

/** Human-readable names for capability keys, for admin and settings screens. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  'job.apply': 'Can apply for jobs',
  'event.attend': 'Can join events',
  'course.enroll': 'Can enrol in courses',
  'job.publish': 'Can post jobs',
  'event.publish': 'Can publish events',
  'course.publish': 'Can publish courses',
  'job.manage_applicants': 'Can manage job applicants',
  'event.manage_attendees': 'Can manage event attendees',
  'course.manage_students': 'Can manage course learners',
  'organization.manage': 'Can manage the organization page',
  'organization.team': 'Can manage the organization team',
  'organization.branding': 'Can edit organization branding',
  'analytics.view': 'Can view analytics',
  'billing.manage': 'Can manage billing',
}

export function capabilityLabel(capability: string) {
  return (CAPABILITY_LABELS as Record<string, string>)[capability]
    ?? capability.replaceAll('.', ' · ').replaceAll('_', ' ')
}
