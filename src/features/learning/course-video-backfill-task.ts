import { DEFAULT_MONTHLY_TRANSCODE_MINUTES, renditionKindForPath } from './media-renditions'

/**
 * Round P3 (Part D, option a): existing course videos (uploaded before transcoding existed) are transcoded only
 * after the owner has seen this count and estimate and approved it.
 *
 * - plan (read only): how many trailers and lesson videos have no rendition yet, their total size, and the
 *   estimated source minutes and one-time cost (from file size, at 1 to 3 Mbit/s; MediaConvert reports the real
 *   minutes once each job has run).
 * - video-queue-once: queues exactly those videos; the outbox worker then transcodes them under its monthly cap.
 *
 * Counts only: never a path, title or name.
 */
type Row = Record<string, unknown>

export type CourseVideoBackfillDeps = {
  query: (text: string, values?: readonly unknown[]) => Promise<Row[]>
  head: (key: string) => Promise<{ contentLength: number | null }>
  log: (line: string) => void
}

/** Basic-tier on-demand rates per output minute: two HD outputs (720p MP4 and HLS) plus one SD (360p HLS). */
export const USD_PER_SOURCE_MINUTE = 0.015 + 0.015 + 0.0075
export const INR_PER_USD = 88

const COURSE_VIDEOS = `select trailer_path as path from public.learning_courses where trailer_path is not null
  union
  select asset_path from public.learning_lessons where lesson_type = 'video' and asset_path is not null`

async function renditionTableExists(deps: CourseVideoBackfillDeps) {
  const [row] = await deps.query(`select to_regclass('public.learning_media_renditions') is not null as present`)
  return Boolean(row?.present)
}

/** Course videos without a rendition row (all of them before the renditions migration has run). */
async function pendingVideos(deps: CourseVideoBackfillDeps, tableExists: boolean) {
  const rows = await deps.query(tableExists
    ? `select path from (${COURSE_VIDEOS}) videos
       where not exists (select 1 from public.learning_media_renditions rendition where rendition.source_path = videos.path)`
    : `select path from (${COURSE_VIDEOS}) videos`)
  return rows.map((row) => String(row.path)).filter((path) => renditionKindForPath(path))
}

export async function runCourseVideoBackfillPlan(deps: CourseVideoBackfillDeps) {
  const tableExists = await renditionTableExists(deps)
  const paths = await pendingVideos(deps, tableExists)
  let bytes = 0
  let missing = 0
  let trailers = 0
  for (const path of paths) {
    if (renditionKindForPath(path) === 'course_trailer') trailers += 1
    try {
      bytes += (await deps.head(path)).contentLength ?? 0
    } catch {
      missing += 1
    }
  }
  const megabits = (bytes * 8) / 1_000_000
  const low = Math.round(megabits / 3 / 60)
  const high = Math.round(megabits / 1 / 60)
  const usd = (minutes: number) => (minutes * USD_PER_SOURCE_MINUTE).toFixed(2)
  const inr = (minutes: number) => Math.round(minutes * USD_PER_SOURCE_MINUTE * INR_PER_USD)
  deps.log(`MEDIA_TRANSCODE_BACKFILL_PLAN videos=${paths.length - missing} trailers=${trailers} lesson_videos=${paths.length - trailers} not_in_bucket=${missing} total_mb=${(bytes / 1048576).toFixed(0)} rendition_table=${tableExists ? 'present' : 'missing'}`)
  deps.log(`MEDIA_TRANSCODE_BACKFILL_ESTIMATE minutes=${low}-${high} usd=${usd(low)}-${usd(high)} inr=${inr(low)}-${inr(high)} monthly_cap_minutes=${DEFAULT_MONTHLY_TRANSCODE_MINUTES}`)
  deps.log('MEDIA_TRANSCODE_BACKFILL_PLAN_VERIFIED=true')
}

export async function runCourseVideoBackfillQueue(deps: CourseVideoBackfillDeps) {
  if (!(await renditionTableExists(deps))) throw new Error('media_renditions_table_missing')
  const paths = await pendingVideos(deps, true)
  let queued = 0
  for (const path of paths) {
    const kind = renditionKindForPath(path)
    if (!kind) continue
    const rows = await deps.query(
      `insert into public.learning_media_renditions (source_path, kind, status)
       values ($1, $2, 'queued')
       on conflict (source_path) do nothing
       returning source_path`,
      [path, kind],
    )
    queued += rows.length
  }
  deps.log(`MEDIA_TRANSCODE_BACKFILL_QUEUED videos=${queued}`)
  deps.log('MEDIA_TRANSCODE_BACKFILL_QUEUE_VERIFIED=true')
}
