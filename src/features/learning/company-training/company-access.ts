import type { QueryResultRow } from 'pg'
import { SeatError } from './seat-rules'

/**
 * Who runs a company's training (round D, part 3): an approved member of the organization with the owner,
 * administrator or learning manager role. The organization must be verified by Sea N Shore. Platform admins may look
 * (read only); nobody else sees anything.
 */

export type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export const COMPANY_TRAINING_ROLES = ['owner', 'administrator', 'lms_manager'] as const

export function companyTrainingAdminSql(companyAlias: string, actorParam: string) {
  return `exists (
    select 1 from public.company_members training_admin
    where training_admin.company_id = ${companyAlias}.id
      and training_admin.user_id = ${actorParam}
      and training_admin.approved_at is not null
      and training_admin.role::text in ('owner', 'administrator', 'lms_manager')
  )`
}

export type TrainingCompany = {
  id: string
  name: string
  slug: string
  verified: boolean
  canManage: boolean
}

export type TrainingActor = { actorId: string; platformAdmin?: boolean }

/** The organization and whether `actor` may manage its training. Throws SeatError when they may not even look. */
export async function loadTrainingCompany(query: Query, actor: TrainingActor, companyId: string, options: { lock?: boolean; manage?: boolean } = {}): Promise<TrainingCompany> {
  const rows = await query(
    `select company.id, company.name, company.slug, company.is_verified,
            ${companyTrainingAdminSql('company', '$2::uuid')} as can_manage
     from public.companies company
     where company.id = $1::uuid
     ${options.lock ? 'for update of company' : ''}`,
    [companyId, actor.actorId],
  )
  const row = rows[0]
  if (!row) throw new SeatError('company_not_found')
  const company: TrainingCompany = {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    verified: Boolean(row.is_verified),
    canManage: Boolean(row.can_manage),
  }
  if (!company.canManage && !actor.platformAdmin) throw new SeatError('company_training_not_allowed')
  if (options.manage) {
    if (!company.canManage) throw new SeatError('company_training_not_allowed')
    if (!company.verified) throw new SeatError('company_not_verified')
  }
  return company
}
