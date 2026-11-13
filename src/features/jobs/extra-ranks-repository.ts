import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction } from '@/lib/db/client'

/**
 * P6 (owner-approved 13 Nov): ranks from other departments that posters added to a department's jobs, shared for
 * everyone (public.job_department_extra_ranks, migration 0103). They show as tick boxes in that department's
 * "Accepted ranks / roles" list for every poster, most used first, never ticked for them.
 */
export type DepartmentExtraRank = { roleKey: string; timesUsed: number }
export type DepartmentExtraRankLink = DepartmentExtraRank & { departmentKey: string; firstAddedAt: string; hidden: boolean }

type Query = <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<T[]>

/**
 * After a job under `departmentKey` saves (inside its transaction): links for its extra ranks exist, and each link's
 * times_used is the number of live jobs under the department that accept the rank. `previousExtras` (the job's
 * extras before an edit) are recounted too, so removing a rank lowers its count. A hidden link stays hidden.
 */
export async function refreshDepartmentExtraRanks(run: Query, departmentKey: string | null, extras: readonly string[], previous: { departmentKey: string | null; extras: readonly string[] } = { departmentKey: null, extras: [] }) {
  const recount = `(select count(*)::int from public.jobs j where j.department_key = $1 and j.deleted_at is null and key = any(j.accepted_role_keys))`
  if (departmentKey && extras.length) {
    await run(
      `insert into public.job_department_extra_ranks as link (department_key, role_key, times_used)
       select $1, key, ${recount} from unnest($2::text[]) as key
       on conflict (department_key, role_key) do update set times_used = excluded.times_used, updated_at = now()`,
      [departmentKey, [...new Set(extras)]],
    )
  }
  const gone = previous.departmentKey && previous.extras.length
    ? previous.extras.filter((key) => previous.departmentKey !== departmentKey || !extras.includes(key))
    : []
  if (previous.departmentKey && gone.length) {
    await run(
      `update public.job_department_extra_ranks link
       set times_used = (select count(*)::int from public.jobs j where j.department_key = $1 and j.deleted_at is null and link.role_key = any(j.accepted_role_keys)),
           updated_at = now()
       where link.department_key = $1 and link.role_key = any($2::text[])`,
      [previous.departmentKey, [...new Set(gone)]],
    )
  }
}

export function createExtraRanksRepository(input: { query?: Query; transaction?: <T>(work: (run: Query) => Promise<T>) => Promise<T> } = {}) {
  const run: Query = input.query ?? ((text, values) => databaseQuery(text, values) as never)
  const transaction = input.transaction ?? ((work) => withTransaction((client) => work((text, values) => client.query(text, values ? [...values] : undefined).then((result) => result.rows as never))))

  /** The shared extras a poster sees under one department, most used first (hidden links left out). */
  async function listShown(departmentKey: string): Promise<DepartmentExtraRank[]> {
    const rows = await run<{ role_key: string; times_used: number }>(
      `select role_key, times_used from public.job_department_extra_ranks
       where department_key = $1 and hidden_at is null
       order by times_used desc, first_added_at asc, role_key asc`,
      [departmentKey],
    )
    return rows.map((row) => ({ roleKey: row.role_key, timesUsed: Number(row.times_used) }))
  }

  /** Every department's shown extras at once (the job form switches departments without a round trip). */
  async function listShownByDepartment(): Promise<Record<string, DepartmentExtraRank[]>> {
    const rows = await run<{ department_key: string; role_key: string; times_used: number }>(
      `select department_key, role_key, times_used from public.job_department_extra_ranks
       where hidden_at is null
       order by department_key, times_used desc, first_added_at asc, role_key asc`,
    )
    const out: Record<string, DepartmentExtraRank[]> = {}
    for (const row of rows) (out[row.department_key] ??= []).push({ roleKey: row.role_key, timesUsed: Number(row.times_used) })
    return out
  }

  /** Admin: every link, hidden ones too, with usage counts. */
  async function listAll(): Promise<DepartmentExtraRankLink[]> {
    const rows = await run<{ department_key: string; role_key: string; times_used: number; first_added_at: string | Date; hidden_at: string | Date | null }>(
      `select department_key, role_key, times_used, first_added_at, hidden_at from public.job_department_extra_ranks
       order by department_key, (hidden_at is not null), times_used desc, role_key`,
    )
    return rows.map((row) => ({
      departmentKey: row.department_key,
      roleKey: row.role_key,
      timesUsed: Number(row.times_used),
      firstAddedAt: new Date(row.first_added_at).toISOString(),
      hidden: row.hidden_at !== null,
    }))
  }

  /** Admin: hide a link from future forms (jobs already posted keep their ranks), or show it again. */
  async function setHidden(adminId: string, departmentKey: string, roleKey: string, hidden: boolean) {
    return transaction(async (tx) => {
      const rows = await tx<{ role_key: string }>(
        `update public.job_department_extra_ranks
         set hidden_at = case when $4::boolean then coalesce(hidden_at, now()) else null end,
             hidden_by = case when $4::boolean then $1::uuid else null end,
             updated_at = now()
         where department_key = $2 and role_key = $3
         returning role_key`,
        [adminId, departmentKey, roleKey, hidden],
      )
      if (!rows[0]) return false
      await tx(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, 'job_department_extra_rank', $3 || ':' || $4, jsonb_build_object('department_key', $3::text, 'role_key', $4::text))`,
        [adminId, hidden ? 'job_extra_rank_hidden' : 'job_extra_rank_shown', departmentKey, roleKey],
      )
      return true
    })
  }

  return { listShown, listShownByDepartment, listAll, setHidden }
}

export const extraRanksRepository = createExtraRanksRepository()

/**
 * P6: the shared extras for the job form. A failure (or the table not created yet) shows the form without them,
 * never an error: the department's own ranks and "Add ranks from other departments" still work.
 */
export async function loadSharedExtraRanks(): Promise<Record<string, DepartmentExtraRank[]>> {
  try {
    return await extraRanksRepository.listShownByDepartment()
  } catch (error) {
    console.warn('[job_extra_ranks_read_failed]', { code: (error as { code?: string })?.code ?? null })
    return {}
  }
}
