// Round P3 (B7, Part D): the one-off media backfill (plan / apply-once), run as an ECS task by
// scripts/aws/media-cdn-backfill.sh. See src/features/media/media-cdn-backfill-task.ts.
import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '../../src/lib/db/client'
import { getMediaObject, headMediaObjectWithMetadata, mediaObjectExists, putMediaObject } from '../../src/lib/aws/storage'
import { prepareMediaForCdn, writeImageVariants } from '../../src/lib/media-cdn/prepare-media'
import { runMediaCdnBackfillApply, runMediaCdnBackfillPlan } from '../../src/features/media/media-cdn-backfill-task'
import { runCourseVideoBackfillPlan, runCourseVideoBackfillQueue } from '../../src/features/learning/course-video-backfill-task'

const mode = process.env.MEDIA_CDN_BACKFILL_MODE ?? 'plan'

const deps = {
  query: async (text: string, values?: readonly unknown[]) => (await databaseQuery<QueryResultRow>(text, values)) as QueryResultRow[],
  exists: mediaObjectExists,
  head: headMediaObjectWithMetadata,
  read: async (key: string, maxBytes: number) => (await getMediaObject({ key, maxBytes })).body,
  put: putMediaObject,
  writeVariants: (key: string, body: Uint8Array) => writeImageVariants(key, body),
  copyFile: (key: string, contentType: string) => prepareMediaForCdn({ key, contentType }),
  log: (line: string) => console.info(line),
}

async function main() {
  if (mode === 'plan') {
    await runMediaCdnBackfillPlan(deps)
    // Round P3 (Part D): the course videos still to transcode, with the estimate the owner approves first.
    await runCourseVideoBackfillPlan(deps)
  } else if (mode === 'apply-once') await runMediaCdnBackfillApply(deps)
  else if (mode === 'video-queue-once') await runCourseVideoBackfillQueue(deps)
  else throw new Error(`Unsupported mode: ${mode}`)
}

main().then(() => process.exit(0), (error: unknown) => {
  console.error('MEDIA_CDN_BACKFILL_FAILED', error instanceof Error ? error.message : 'unknown_error')
  process.exit(1)
})
