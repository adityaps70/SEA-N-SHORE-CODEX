import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction } from '@/lib/db/client'
import { allRoles, departmentByKey, normaliseRoleText, roleByKey } from './taxonomy'

/**
 * P6b (owner-approved 15 Nov): platform administrators add a missing rank to the master list, public.maritime_ranks
 * (source 'admin'), or hide one they added. A rank is placed above, at the same level as, or below an existing rank of
 * the same department and ladder: its position sits between its neighbours, so matching and the feed and
 * people-you-may-know rank bands count it as the step between them. Codes are never reused and ranks never deleted;
 * a hidden rank leaves the pickers but jobs and profiles that have it keep it. Every change writes an audit event.
 */
type Query = <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<T[]>

export const ADDED_RANK_LABEL_MIN = 2
export const ADDED_RANK_LABEL_MAX = 60
export const ADDED_RANK_SYNONYMS_MAX = 8
export type AnchorRelation = 'above' | 'same' | 'below'

export type AddRankInput = {
  label: string
  departmentKey: string
  anchorKey: string
  relation: AnchorRelation
  synonyms?: readonly string[]
}

export type AddRankResult =
  | { status: 'added'; code: string }
  | { status: 'error'; error: 'invalid_label' | 'invalid_department' | 'invalid_anchor' | 'duplicate' | 'no_room' | 'invalid_synonym' }

export type AddedRankSummary = { code: string; profiles: number; jobs: number }

function cleanText(value: string) {
  return value.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim()
}

/** Every text an existing rank answers to (its label, the label without the bracketed part, and its other names). */
function takenTexts() {
  const taken = new Set<string>()
  for (const role of allRoles()) {
    if (role.other) continue
    for (const text of [role.label, role.label.replace(/\s*\([^)]*\)\s*/g, ' '), ...role.synonyms]) {
      const normalised = normaliseRoleText(text)
      if (normalised) taken.add(normalised)
    }
  }
  return taken
}

/** The validated input, or the reason it is refused. Uses the live rank list (code list plus added ranks). */
export function checkAddRankInput(input: AddRankInput):
  | { ok: true; label: string; synonyms: string[]; anchor: { key: string; ladder: string } }
  | { ok: false; error: Exclude<AddRankResult, { status: 'added' }>['error'] } {
  const label = cleanText(input.label ?? '')
  if (label.length < ADDED_RANK_LABEL_MIN || label.length > ADDED_RANK_LABEL_MAX || !/[a-z]/i.test(label)) return { ok: false, error: 'invalid_label' }
  if (!departmentByKey(input.departmentKey)) return { ok: false, error: 'invalid_department' }
  const anchor = roleByKey(input.anchorKey)
  if (!anchor || anchor.other || anchor.department !== input.departmentKey || !['above', 'same', 'below'].includes(input.relation)) {
    return { ok: false, error: 'invalid_anchor' }
  }
  const synonyms = [...new Set((input.synonyms ?? []).map(cleanText).filter(Boolean))]
  if (synonyms.length > ADDED_RANK_SYNONYMS_MAX || synonyms.some((s) => s.length > ADDED_RANK_LABEL_MAX)) return { ok: false, error: 'invalid_synonym' }
  const taken = takenTexts()
  const own = [label, ...synonyms].map(normaliseRoleText)
  if (own.some((text) => !text || taken.has(text))) return { ok: false, error: 'duplicate' }
  if (new Set(own).size !== own.length) return { ok: false, error: 'invalid_synonym' }
  return { ok: true, label, synonyms, anchor: { key: anchor.key, ladder: anchor.ladder } }
}

/** A new rank's position next to its anchor's (`places` = every position on that ladder). Null when there is no room. */
export function positionFor(anchorPlace: number, relation: AnchorRelation, places: readonly number[]): number | null {
  const round = (value: number) => Math.round(value * 10_000) / 10_000
  if (relation === 'same') return anchorPlace
  const sorted = [...new Set(places)].sort((a, b) => a - b)
  if (relation === 'below') {
    const next = sorted.find((place) => place > anchorPlace)
    const position = round(next === undefined ? anchorPlace + 1 : (anchorPlace + next) / 2)
    return position > anchorPlace && (next === undefined || position < next) ? position : null
  }
  const previous = [...sorted].reverse().find((place) => place < anchorPlace)
  const position = round(previous === undefined ? anchorPlace - 1 : (previous + anchorPlace) / 2)
  return position < anchorPlace && (previous === undefined || position > previous) ? position : null
}

export function codeFor(label: string) {
  const slug = normaliseRoleText(label).replace(/ /g, '_').slice(0, 40).replace(/_+$/, '')
  return `added_${slug || 'rank'}`
}

export function createAdminRanksRepository(input: { query?: Query; transaction?: <T>(work: (run: Query) => Promise<T>) => Promise<T> } = {}) {
  const run: Query = input.query ?? ((text, values) => databaseQuery(text, values ? [...values] : undefined) as never)
  const transaction = input.transaction ?? ((work) => withTransaction((client) => work((text, values) => client.query(text, values ? [...values] : undefined).then((result) => result.rows as never))))

  async function addRank(adminId: string, rank: AddRankInput): Promise<AddRankResult> {
    const checked = checkAddRankInput(rank)
    if (!checked.ok) return { status: 'error', error: checked.error }
    return transaction(async (tx) => {
      // One administrator change at a time, so two ranks placed in the same gap never get the same position.
      await tx(`select pg_advisory_xact_lock(hashtext('p6b_admin_ranks'))`)
      const ladder = await tx<{ code: string; department: string; place: string }>(
        `select code, department, coalesce(position, ladder_level::numeric)::text as place
         from public.maritime_ranks where department_key = $1 and ladder = $2`,
        [rank.departmentKey, checked.anchor.ladder],
      )
      const anchor = ladder.find((row) => row.code === checked.anchor.key)
      if (!anchor) return { status: 'error', error: 'invalid_anchor' }
      const position = positionFor(Number(anchor.place), rank.relation, ladder.map((row) => Number(row.place)))
      if (position === null) return { status: 'error', error: 'no_room' }
      // A database-side duplicate check too (a rank added on another server in the last 30 seconds).
      const names = [checked.label, ...checked.synonyms].map(normaliseRoleText)
      const clash = await tx(
        `select 1 from public.maritime_ranks r
         where btrim(regexp_replace(replace(lower(r.name), '&', ' and '), '[^a-z0-9]+', ' ', 'g')) = any($1::text[])
            or exists (select 1 from unnest(r.synonyms) synonym where btrim(regexp_replace(replace(lower(synonym), '&', ' and '), '[^a-z0-9]+', ' ', 'g')) = any($1::text[]))
         limit 1`,
        [names],
      )
      if (clash.length) return { status: 'error', error: 'duplicate' }
      const base = codeFor(checked.label)
      const existing = new Set((await tx<{ code: string }>(`select code from public.maritime_ranks where code like $1`, [`${base}%`])).map((row) => row.code))
      let code = base
      for (let n = 2; existing.has(code) || roleByKey(code); n += 1) code = `${base}_${n}`
      const order = await tx<{ next: number }>(`select coalesce(max(sort_order), 1000) + 1 as next from public.maritime_ranks where sort_order >= 1000`)
      await tx(
        `insert into public.maritime_ranks
           (code, name, department_key, department, ladder, ladder_level, synonyms, same_as, sort_order,
            position, source, anchor_code, anchor_relation, added_by, added_at)
         values ($1, $2, $3, $4, $5, $6, $7::text[], null, $8, $9, 'admin', $10, $11, $12, now())`,
        [code, checked.label, rank.departmentKey, anchor.department, checked.anchor.ladder,
          Math.min(99, Math.max(1, Math.round(position))), checked.synonyms, Number(order[0]?.next ?? 1001), position,
          checked.anchor.key, rank.relation, adminId],
      )
      await tx(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'admin.rank_added', 'maritime_rank', $2, jsonb_build_object('department_key', $3::text, 'anchor_code', $4::text, 'relation', $5::text))`,
        [adminId, code, rank.departmentKey, checked.anchor.key, rank.relation],
      )
      return { status: 'added', code }
    })
  }

  /** Hides (or shows again) a rank an administrator added. False when there is no such added rank or nothing changed. */
  async function setHidden(adminId: string, code: string, hidden: boolean): Promise<boolean> {
    return transaction(async (tx) => {
      const rows = await tx(
        `update public.maritime_ranks
         set hidden_at = case when $2 then now() else null end, hidden_by = case when $2 then $3::uuid else null end
         where code = $1 and source = 'admin' and (hidden_at is null) = $2
         returning code`,
        [code, hidden, adminId],
      )
      if (!rows[0]) return false
      await tx(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, 'maritime_rank', $3, '{}'::jsonb)`,
        [adminId, hidden ? 'admin.rank_hidden' : 'admin.rank_shown', code],
      )
      return true
    })
  }

  /** For each added rank: how many profiles hold it and how many jobs accept it (counts only). */
  async function usage(): Promise<AddedRankSummary[]> {
    const rows = await run<{ code: string; profiles: number; jobs: number }>(
      `select r.code,
              (select count(*)::int from public.profiles p where p.role_key = r.code) as profiles,
              (select count(*)::int from public.jobs j where j.accepted_role_keys @> array[r.code]) as jobs
       from public.maritime_ranks r where r.source = 'admin' order by r.added_at, r.code`,
    )
    return rows.map((row) => ({ code: row.code, profiles: Number(row.profiles), jobs: Number(row.jobs) }))
  }

  return { addRank, setHidden, usage }
}

export const adminRanksRepository = createAdminRanksRepository()
