import { query } from '@/lib/db/client'
import { runTaxonomyBackfill } from '@/features/taxonomy/backfill'
import { purgeExpiredSignals } from '@/features/signals/retention'
import { createPeopleSweep } from './people-sweep'

/**
 * Round G: the ranking jobs, run from the existing outbox worker loop (scripts/workers/publish-outbox.ts)
 * like every other periodic job. Each is time-gated in memory, runs once when the task starts, and
 * is idempotent, so a restart or a second task does no harm. Logs carry counts only.
 */
type Sweep = {
  name: string
  everyMs: number
  /** A result is logged; undefined means "nothing worth logging" (a sweep part-way through its run). */
  run(): Promise<Record<string, unknown> | void | undefined>
}

export const SIGNAL_RETENTION_SWEEP_MS = 60 * 60 * 1000
export const TAXONOMY_BACKFILL_SWEEP_MS = 24 * 60 * 60 * 1000

/** True once migration 0083 is applied; until then the sweeps wait quietly. */
async function roundGSchemaReady() {
  const rows = await query(`select to_regclass('public.ranking_settings') is not null as ready`)
  return rows[0]?.ready === true
}

export function createRankingSweeps(input: {
  sweeps?: Sweep[]
  now?: () => number
  log?: (tag: string, data: unknown) => void
  schemaReady?: () => Promise<boolean>
} = {}) {
  const now = input.now ?? Date.now
  const log = input.log ?? ((tag, data) => console.info(tag, data))
  const sweeps: Sweep[] = input.sweeps ?? [
    { name: 'signal_retention', everyMs: SIGNAL_RETENTION_SWEEP_MS, run: () => purgeExpiredSignals() },
    { name: 'taxonomy_backfill', everyMs: TAXONOMY_BACKFILL_SWEEP_MS, run: () => runTaxonomyBackfill() },
    // Nightly People you may know (02:00 IST), 25 members per loop pass; it keeps its own schedule.
    createPeopleSweep(),
  ]
  const nextAt = new Map<string, number>()
  const schemaReady = input.schemaReady ?? roundGSchemaReady
  let readyCheckedAt = -Infinity
  let ready = false

  async function runDue() {
    if (!ready && now() - readyCheckedAt >= 10 * 60 * 1000) {
      readyCheckedAt = now()
      ready = await schemaReady().catch(() => false)
    }
    if (!ready) return
    for (const sweep of sweeps) {
      const current = now()
      if (current < (nextAt.get(sweep.name) ?? 0)) continue
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
