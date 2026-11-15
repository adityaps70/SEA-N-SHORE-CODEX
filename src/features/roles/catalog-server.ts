import { setAddedRoles, type RoleEntry } from './taxonomy'

/**
 * P6b (owner-approved 15 Nov): loads the ranks administrators added (public.maritime_ranks, source 'admin') into the
 * live rank list (taxonomy.setAddedRoles). Every server loads them when it starts and again every 30 seconds; the
 * server where a rank is added reloads at once. Pages pass them to the browser (RoleCatalogSync), so a new rank shows
 * everywhere within 30 seconds: job validation, pickers, profiles, search and matching.
 *
 * A failed load keeps the last list (logged by tag only, at most once a minute). Before migration 0105 the columns are
 * missing: there are no added ranks.
 */
export const ROLE_CATALOG_REFRESH_MS = 30_000

type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export const ADDED_RANKS_SQL = `select code, name, department_key, ladder, ladder_level, position, synonyms, same_as,
  anchor_code, anchor_relation, hidden_at
from public.maritime_ranks
where source = 'admin'
order by added_at, code`

function isMissingSchema(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : null
  return code === '42P01' || code === '42703'
}

export function addedRoleFromRow(row: Record<string, unknown>): RoleEntry | null {
  const key = typeof row.code === 'string' ? row.code : null
  const label = typeof row.name === 'string' ? row.name : null
  const department = typeof row.department_key === 'string' ? row.department_key : null
  const ladder = typeof row.ladder === 'string' ? row.ladder : null
  const position = row.position === null || row.position === undefined ? NaN : Number(row.position)
  if (!key || !label || !department || !ladder || !Number.isFinite(position)) return null
  const relation = row.anchor_relation
  return {
    key,
    label,
    department,
    ladder,
    level: Number(row.ladder_level ?? Math.round(position)) || Math.round(position),
    position,
    synonyms: Array.isArray(row.synonyms) ? row.synonyms.filter((s): s is string => typeof s === 'string') : [],
    ...(typeof row.same_as === 'string' ? { sameAs: row.same_as } : {}),
    added: true,
    ...(typeof row.anchor_code === 'string' ? { anchorKey: row.anchor_code } : {}),
    ...(relation === 'above' || relation === 'same' || relation === 'below' ? { anchorRelation: relation } : {}),
    ...(row.hidden_at ? { hidden: true } : {}),
  }
}

export function createRoleCatalogLoader(input: {
  query: Query
  apply?: (entries: RoleEntry[]) => void
  now?: () => number
  refreshMs?: number
  warn?: (tag: string, context: Record<string, string>) => void
}) {
  const apply = input.apply ?? setAddedRoles
  const now = input.now ?? Date.now
  const refreshMs = input.refreshMs ?? ROLE_CATALOG_REFRESH_MS
  const warn = input.warn ?? ((tag, context) => console.warn(tag, context))
  let loadedAt = -Infinity
  let warnedAt = -Infinity
  let inFlight: Promise<void> | null = null

  async function reload() {
    try {
      const rows = await input.query(ADDED_RANKS_SQL)
      apply(rows.map(addedRoleFromRow).filter((entry): entry is RoleEntry => entry !== null))
      loadedAt = now()
    } catch (error) {
      if (isMissingSchema(error)) {
        apply([])
        loadedAt = now()
        return
      }
      // Keep the last list; try again at the next call.
      if (warnedAt <= now() - 60_000) {
        warnedAt = now()
        warn('[role_catalog_unavailable]', { stage: 'load' })
      }
    }
  }

  return {
    /** Loads the added ranks if the last load is older than 30 seconds (one load at a time). Never throws. */
    ensure(): Promise<void> {
      if (now() - loadedAt < refreshMs) return Promise.resolve()
      if (!inFlight) inFlight = reload().finally(() => { inFlight = null })
      return inFlight
    },
    /** Loads them now (after an administrator adds or hides a rank on this server). Never throws. */
    reload(): Promise<void> {
      inFlight = reload().finally(() => { inFlight = null })
      return inFlight
    },
  }
}
