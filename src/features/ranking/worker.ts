import { query } from '@/lib/db/client'
import { runTaxonomyBackfill } from '@/features/taxonomy/backfill'
import { ensureRoleCatalog } from '@/features/roles/catalog-runtime'
import { purgeExpiredSignals } from '@/features/signals/retention'
import { createCounterReconcileSweep } from './engagement-counters-reconcile'
import { createOnlinePeakSweep } from './online-peak-sweep'
import { createPeopleSweep } from './people-sweep'
import { createJobAlertSweep } from './job-alerts'
import { createRankingEmailSweep } from './ranking-email-sending'
import { createWeeklyDigestSweep } from './weekly-digest'

/**
 * Round G: the ranking jobs, run from the existing outbox worker loop (scripts/workers/publish-outbox.ts)
 * like every other periodic job. Each is time-gated in memory, runs once when the task starts, and
 * is idempotent, so a restart or a second task does no harm. Logs carry counts only.
 */
type Sweep = {
  name: string
  everyMs: number
  /** A table the sweep needs (a later migration); until it exists the sweep waits quietly. */
  requiresTable?: string
  /** A result is logged; undefined means "nothing worth logging" (a sweep part-way through its run). */
  run(): Promise<Record<string, unknown> | void | undefined>
}

export const SIGNAL_RETENTION_SWEEP_MS = 60 * 60 * 1000
export const TAXONOMY_BACKFILL_SWEEP_MS = 24 * 60 * 60 * 1000

/** True once migration 0083 is applied; until then the sweeps wait quietly. */
async function roundGSchemaReady() {
  return tableExists('ranking_settings')
}

async function tableExists(table: string) {
  const rows = await query(`select to_regclass($1) is not null as ready`, [`public.${table}`])
  return rows[0]?.ready === true
}

export function createRankingSweeps(input: {
  sweeps?: Sweep[]
  now?: () => number
  log?: (tag: string, data: unknown) => void
  schemaReady?: () => Promise<boolean>
  tableReady?: (table: string) => Promise<boolean>
  /** P6b: the ranks administrators added, loaded before the sweeps that match or label ranks run. */
  ensureCatalog?: () => Promise<void>
} = {}) {
  const now = input.now ?? Date.now
  const log = input.log ?? ((tag, data) => console.info(tag, data))
  const sweeps: Sweep[] = input.sweeps ?? [
    { name: 'signal_retention', everyMs: SIGNAL_RETENTION_SWEEP_MS, run: () => purgeExpiredSignals() },
    { name: 'taxonomy_backfill', everyMs: TAXONOMY_BACKFILL_SWEEP_MS, run: () => runTaxonomyBackfill() },
    // Nightly People you may know (02:00 IST), 10 members every 30 seconds; it keeps its own schedule.
    createPeopleSweep(),
    // Release 2 (migration 0085): job alerts are queued from 02:00 UTC, and the queue is sent every minute.
    createJobAlertSweep(),
    createWeeklyDigestSweep(),
    createRankingEmailSweep(),
    // Round CAP (finding 8): the hourly peak of signed-in members online, once a minute.
    createOnlinePeakSweep(),
    // Round CAP (feed counters): nightly recount of the migration 0102 counters, 500 rows per pass.
    createCounterReconcileSweep(),
  ]
  const ensureCatalog = input.ensureCatalog ?? (input.sweeps ? async () => undefined : ensureRoleCatalog)
  const nextAt = new Map<string, number>()
  const schemaReady = input.schemaReady ?? roundGSchemaReady
  const tableReady = input.tableReady ?? tableExists
  const tables = new Map<string, { ready: boolean; checkedAt: number }>()
  let readyCheckedAt = -Infinity
  let ready = false

  async function hasTable(table: string) {
    const known = tables.get(table)
    if (known?.ready) return true
    if (known && now() - known.checkedAt < 10 * 60 * 1000) return false
    const found = await tableReady(table).catch(() => false)
    tables.set(table, { ready: found, checkedAt: now() })
    return found
  }

  async function runDue() {
    if (!ready && now() - readyCheckedAt >= 10 * 60 * 1000) {
      readyCheckedAt = now()
      ready = await schemaReady().catch(() => false)
    }
    if (!ready) return
    await ensureCatalog().catch(() => undefined)
    for (const sweep of sweeps) {
      const current = now()
      if (current < (nextAt.get(sweep.name) ?? 0)) continue
      if (sweep.requiresTable && !await hasTable(sweep.requiresTable)) continue
      nextAt.set(sweep.name, current + sweep.everyMs)
      try {
        const result = await sweep.run()
        if (result) log(`[ranking_sweep_${sweep.name}]`, result)
      } catch (error) {
        console.error(`[ranking_sweep_${sweep.name}_error]`, error instanceof Error ? error.message : 'unknown_error')
      }
    }
  }

  return { runDue }
}
