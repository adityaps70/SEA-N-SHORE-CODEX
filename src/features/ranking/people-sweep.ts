import { query as databaseQuery } from '@/lib/db/client'
import { createPeopleCandidateRepository, peopleCandidateRepository } from './people-candidates'
import { createPeopleSuggestions, peopleSuggestions } from './people-suggestions'

/**
 * Round G (G2): the nightly People you may know rebuild, run from the outbox worker loop. It starts
 * at 02:00 India time (20:30 UTC), or straight away when nothing has been computed yet (the first
 * run after release), and refreshes 25 members per loop pass so the outbox never waits long.
 */
export const PEOPLE_SWEEP_BATCH = 25
export const PEOPLE_SWEEP_START_UTC = { hour: 20, minute: 30 }

export function nextNightlyStart(after: Date) {
  const next = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), PEOPLE_SWEEP_START_UTC.hour, PEOPLE_SWEEP_START_UTC.minute))
  if (next.getTime() <= after.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime()
}

type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export function createPeopleSweep(input: {
  candidates?: ReturnType<typeof createPeopleCandidateRepository>
  service?: ReturnType<typeof createPeopleSuggestions>
  query?: Query
  now?: () => number
  batchSize?: number
} = {}) {
  const candidates = input.candidates ?? peopleCandidateRepository
  const service = input.service ?? peopleSuggestions
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const now = input.now ?? Date.now
  const batchSize = input.batchSize ?? PEOPLE_SWEEP_BATCH
  let nextRunAt: number | null = null
  let running = false
  let cursor: string | null = null
  let processed = 0
  let startedAt = 0

  /** One step. Returns a summary when a full run finishes, otherwise undefined (nothing to log). */
  async function run(): Promise<Record<string, unknown> | undefined> {
    if (!running) {
      if (nextRunAt === null) {
        const rows = await queryRows(`select exists (select 1 from public.people_suggestions) as filled`)
        nextRunAt = rows[0]?.filled === true ? nextNightlyStart(new Date(now())) : now()
      }
      if (now() < nextRunAt) return undefined
      running = true
      cursor = null
      processed = 0
      startedAt = now()
    }
    const ids = await candidates.listViewersToRefresh(cursor, batchSize)
    for (const id of ids) await service.refreshQuietly(id)
    processed += ids.length
    cursor = ids.at(-1) ?? cursor
    if (ids.length === batchSize) return undefined
    running = false
    nextRunAt = nextNightlyStart(new Date(now()))
    return { members: processed, seconds: Math.round((now() - startedAt) / 1000) }
  }

  return { name: 'people_suggestions', everyMs: 0, run }
}
