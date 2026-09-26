import type { OrganizationAccessRole } from '@/features/access/policy'
import type { CompanyAccessRequestRole } from './types'

export const ACCESS_ROLE_LABELS: Record<OrganizationAccessRole, string> = {
  owner: 'Owner',
  administrator: 'Administrator',
  recruiter: 'Recruiter / HR',
  lms_manager: 'Learning manager',
  event_manager: 'Events manager',
  content_manager: 'Content manager',
  analyst: 'Analyst',
  member: 'Member / employee',
}

export const REQUESTABLE_ROLE_DESCRIPTIONS: Record<CompanyAccessRequestRole, string> = {
  member: 'Shows you as part of the organization. No publishing rights.',
  recruiter: 'Post jobs and manage applicants for the organization.',
  administrator: 'Manage the workspace, its team and its access requests.',
  lms_manager: 'Publish courses and manage learners.',
  event_manager: 'Publish events and manage attendees.',
  content_manager: 'Edit the organization page and branding.',
  analyst: 'View workspace analytics.',
}

export function accessRoleLabel(role: string | null | undefined) {
  if (!role) return 'Member / employee'
  return ACCESS_ROLE_LABELS[role as OrganizationAccessRole] ?? role.replaceAll('_', ' ')
}

/** "today", "yesterday" or "5 days ago", relative to a fixed server time so markup matches on hydration. */
export function relativeDays(value: string | null | undefined, nowIso: string) {
  if (!value) return ''
  const then = new Date(value).getTime()
  const now = new Date(nowIso).getTime()
  if (!Number.isFinite(then) || !Number.isFinite(now)) return ''
  const days = Math.max(0, Math.floor((now - then) / (24 * 60 * 60 * 1000)))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
