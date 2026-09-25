import type { Capability } from '@/features/access/policy'

export const ADMIN_PERSONAL_GRANTABLE_CAPABILITIES = [
  'job.publish',
  'event.publish',
  'course.publish',
] as const satisfies readonly Capability[]

export const ADMIN_ORGANIZATION_GRANTABLE_CAPABILITIES = [
  'job.publish',
  'event.publish',
  'course.publish',
  'job.manage_applicants',
  'event.manage_attendees',
  'course.manage_students',
  'analytics.view',
] as const satisfies readonly Capability[]

export type AdminEntitlementSubjectType = 'profile' | 'company'

export type AdminEntitlementGrantInput = {
  subjectType: AdminEntitlementSubjectType
  subjectId: string
  capability: Capability
  reason: string
}
