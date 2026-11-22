// Learning round E: the one-off content task (plan / apply-once), run as an ECS task by
// scripts/aws/learning-round-e-content.sh. See src/features/learning/round-e-content-task.ts.
import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction } from '../../src/lib/db/client'
import { courseRevisionRepository } from '../../src/features/learning/course-revision-repository'
import { runRoundEContentApply, runRoundEContentPlan } from '../../src/features/learning/round-e-content-task'
import { DEFAULT_PUBLIC_SITE_URL } from '../../src/config/public-site'

const mode = process.env.ROUND_E_CONTENT_MODE ?? 'plan'

const deps = {
  query: async (text: string, values?: readonly unknown[]) => (await databaseQuery<QueryResultRow>(text, values)) as QueryResultRow[],
  transaction: <T>(work: (query: (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>) => Promise<T>) =>
    withTransaction(async (client) => work(async (text, values) => (await client.query(text, values)).rows)),
  startRevision: (actorId: string, liveCourseId: string) => courseRevisionRepository.startRevision(actorId, liveCourseId),
  log: (line: string) => console.info(line),
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_PUBLIC_SITE_URL).replace(/\/$/, ''),
}

async function main() {
  if (mode === 'plan') await runRoundEContentPlan(deps)
  else if (mode === 'apply-once') await runRoundEContentApply(deps, process.env.ROUND_E_CONTENT_CONFIRM)
  else throw new Error(`Unsupported mode: ${mode}`)
}

main().then(() => process.exit(0), (error: unknown) => {
  console.error('ROUND_E_CONTENT_FAILED', error instanceof Error ? error.message : 'unknown_error')
  process.exit(1)
})
