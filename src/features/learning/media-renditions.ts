import { mediaCdnId } from '@/lib/media-cdn/cdn-keys'
import { mediaCdnExpiry, signMediaCdnFolder, type MediaCdnAccess } from '@/lib/media-cdn/signer'

/**
 * Round P3 (Part D, option a): MediaConvert renditions of course trailers and lesson videos.
 *
 * Each uploaded video gets a 720p MP4 and an HLS ladder (360p and 720p), written under `m/v/<id>/` (the id is a
 * hash of the storage path, like every CDN folder) and served by the signed media CDN. One signed folder query
 * covers the playlist, every segment and the MP4. Players use a ready rendition and fall back to the uploaded file
 * while it is missing, queued or failed. Only Basic-tier features are used (single-pass AVC, MP4 and HLS), and the
 * outbox worker stops starting jobs once a month's transcoded minutes reach the cap.
 */
export type RenditionKind = 'course_trailer' | 'lesson_video'
export type RenditionStatus = 'queued' | 'processing' | 'ready' | 'error' | 'unreferenced'

export const RENDITION_KINDS: readonly RenditionKind[] = ['course_trailer', 'lesson_video']
/** Source minutes per month the worker may transcode (about US$9 at Basic-tier HD/SD rates, under the US$11.40 budget). */
export const DEFAULT_MONTHLY_TRANSCODE_MINUTES = 240
/** Jobs running at once. */
export const MAX_CONCURRENT_TRANSCODES = 2
export const MAX_TRANSCODE_ATTEMPTS = 2

export function renditionFolder(sourcePath: string): string {
  return `m/v/${mediaCdnId(sourcePath)}`
}

/** Output names MediaConvert gives the outputs below (destination base name plus each name modifier). */
export const RENDITION_FILES = {
  master: 'hls/master.m3u8',
  low: 'hls/master_360p.m3u8',
  mp4: 'mp4/video-720p.mp4',
} as const

export function renditionKindForPath(sourcePath: string): RenditionKind | null {
  const kind = sourcePath.split('/')[3]
  return kind === 'course_trailer' || kind === 'lesson_video' ? kind : null
}

export type RenditionSources = {
  /** The 720p MP4: plays anywhere, and is what a browser without HLS support gets. */
  mp4: string
  /** The adaptive HLS ladder (360p and 720p). */
  hls: string
  /** The 360p HLS playlist alone, for Data saver. */
  lowHls: string
  expiresAt: string
}

/**
 * Signed URLs of a ready rendition. Trailers are public promotion (30-day windows); lesson videos use 1-hour
 * windows, and the player refreshes them before they expire.
 */
export function renditionSources(sourcePath: string, now = Date.now()): RenditionSources | null {
  const kind = renditionKindForPath(sourcePath)
  if (!kind) return null
  const access: MediaCdnAccess = kind === 'course_trailer' ? 'public' : 'lesson'
  const folder = renditionFolder(sourcePath)
  const query = signMediaCdnFolder(folder, access, { now })
  if (!query) return null
  return {
    mp4: `/${folder}/${RENDITION_FILES.mp4}?${query}`,
    hls: `/${folder}/${RENDITION_FILES.master}?${query}`,
    lowHls: `/${folder}/${RENDITION_FILES.low}?${query}`,
    expiresAt: new Date(mediaCdnExpiry(folder, access, now) * 1000).toISOString(),
  }
}

type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

/** Queues a newly saved course video (a file already queued, done or failed keeps its row). */
export async function enqueueRendition(query: Query, sourcePath: string): Promise<void> {
  const kind = renditionKindForPath(sourcePath)
  if (!kind) return
  await query(
    `insert into public.learning_media_renditions (source_path, kind, status)
     values ($1, $2, 'queued')
     on conflict (source_path) do nothing`,
    [sourcePath, kind],
  )
}

/** Source paths (of those given) whose rendition is ready. */
export async function readyRenditionPaths(query: Query, sourcePaths: string[]): Promise<Set<string>> {
  const paths = [...new Set(sourcePaths.filter((path) => renditionKindForPath(path)))]
  if (!paths.length) return new Set()
  try {
    const rows = await query(
      `select source_path from public.learning_media_renditions where source_path = any($1::text[]) and status = 'ready'`,
      [paths],
    )
    return new Set(rows.map((row) => String(row.source_path)))
  } catch {
    // Before the table exists (or on a database hiccup) players simply use the uploaded file.
    return new Set()
  }
}

/** The MediaConvert job for one video: 720p MP4 plus HLS 360p and 720p, never upscaled. */
export function buildTranscodeJob(input: { bucket: string; sourcePath: string; roleArn: string; withAudio: boolean }) {
  const folder = renditionFolder(input.sourcePath)
  const video = (width: number, height: number, maxBitrate: number) => ({
    Width: width,
    Height: height,
    ScalingBehavior: 'FIT_NO_UPSCALE' as const,
    AntiAlias: 'ENABLED' as const,
    CodecSettings: {
      Codec: 'H_264' as const,
      H264Settings: {
        RateControlMode: 'QVBR' as const,
        QvbrSettings: { QvbrQualityLevel: 7 },
        MaxBitrate: maxBitrate,
        QualityTuningLevel: 'SINGLE_PASS' as const,
        CodecProfile: 'MAIN' as const,
        CodecLevel: 'AUTO' as const,
        GopSize: 2,
        GopSizeUnits: 'SECONDS' as const,
        SceneChangeDetect: 'TRANSITION_DETECTION' as const,
        FramerateControl: 'INITIALIZE_FROM_SOURCE' as const,
        ParControl: 'INITIALIZE_FROM_SOURCE' as const,
      },
    },
  })
  const audio = (bitrate: number) => (input.withAudio
    ? { AudioDescriptions: [{ AudioSourceName: 'Audio Selector 1', CodecSettings: { Codec: 'AAC' as const, AacSettings: { Bitrate: bitrate, CodingMode: 'CODING_MODE_2_0' as const, SampleRate: 48000 } } }] }
    : {})
  return {
    Role: input.roleArn,
    StatusUpdateInterval: 'SECONDS_60' as const,
    UserMetadata: { kind: renditionKindForPath(input.sourcePath) ?? 'unknown' },
    Settings: {
      TimecodeConfig: { Source: 'ZEROBASED' as const },
      Inputs: [{
        FileInput: `s3://${input.bucket}/${input.sourcePath}`,
        TimecodeSource: 'ZEROBASED' as const,
        VideoSelector: {},
        ...(input.withAudio ? { AudioSelectors: { 'Audio Selector 1': { DefaultSelection: 'DEFAULT' as const } } } : {}),
      }],
      OutputGroups: [
        {
          Name: 'MP4 720p',
          OutputGroupSettings: { Type: 'FILE_GROUP_SETTINGS' as const, FileGroupSettings: { Destination: `s3://${input.bucket}/${folder}/mp4/video` } },
          Outputs: [{ NameModifier: '-720p', ContainerSettings: { Container: 'MP4' as const, Mp4Settings: { MoovPlacement: 'PROGRESSIVE_DOWNLOAD' as const } }, VideoDescription: video(1280, 720, 2_500_000), ...audio(128_000) }],
        },
        {
          Name: 'HLS',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS' as const,
            HlsGroupSettings: {
              Destination: `s3://${input.bucket}/${folder}/hls/master`,
              SegmentLength: 6,
              MinSegmentLength: 0,
              DirectoryStructure: 'SINGLE_DIRECTORY' as const,
              ManifestDurationFormat: 'INTEGER' as const,
              OutputSelection: 'MANIFESTS_AND_SEGMENTS' as const,
              SegmentControl: 'SEGMENTED_FILES' as const,
              ProgramDateTime: 'EXCLUDE' as const,
              CodecSpecification: 'RFC_4281' as const,
              StreamInfResolution: 'INCLUDE' as const,
              ClientCache: 'ENABLED' as const,
            },
          },
          Outputs: [
            { NameModifier: '_720p', ContainerSettings: { Container: 'M3U8' as const, M3u8Settings: {} }, VideoDescription: video(1280, 720, 2_500_000), ...audio(128_000) },
            { NameModifier: '_360p', ContainerSettings: { Container: 'M3U8' as const, M3u8Settings: {} }, VideoDescription: video(640, 360, 700_000), ...audio(64_000) },
          ],
        },
      ],
    },
  }
}

export type TranscodeJob = ReturnType<typeof buildTranscodeJob>

export type TranscodeSweepDeps = {
  query: Query
  createJob: (job: TranscodeJob) => Promise<{ jobId: string }>
  getJob: (jobId: string) => Promise<{ status: string; errorCode?: number | null; errorMessage?: string | null; durationMs?: number | null }>
  bucket: string
  roleArn: string
  monthlyMinuteCap?: number
  log: (line: string) => void
}

function safeCode(value: unknown): string {
  const text = String(value ?? 'unknown').replace(/[^A-Za-z0-9_.:-]/g, '_')
  return text.slice(0, 120) || 'unknown'
}

function isMissingAudioError(message: string | null | undefined) {
  return /audio/i.test(message ?? '')
}

/**
 * One pass of the transcode queue (the outbox worker runs it every minute):
 * 1. polls running jobs and marks them ready (with the source duration) or failed;
 * 2. starts queued jobs, at most two at a time, while the month's minutes are under the cap. A queued video that
 *    no course or lesson references any more is marked unreferenced instead of being transcoded. A job that fails
 *    for want of an audio track is tried once more without audio.
 * Logs counts and job states only.
 */
export async function runTranscodeSweep(deps: TranscodeSweepDeps) {
  let completed = 0
  let failed = 0
  let started = 0
  const processing = await deps.query(
    `select source_path, job_id from public.learning_media_renditions where status = 'processing' order by updated_at limit 10`,
  )
  for (const row of processing) {
    const jobId = String(row.job_id ?? '')
    if (!jobId) continue
    const job = await deps.getJob(jobId)
    if (job.status === 'COMPLETE') {
      await deps.query(
        `update public.learning_media_renditions
         set status = 'ready', duration_seconds = $2, error_code = null, ready_at = now(), updated_at = now()
         where source_path = $1 and job_id = $3`,
        [row.source_path, job.durationMs ? Math.round(job.durationMs / 1000) : null, jobId],
      )
      completed += 1
    } else if (job.status === 'ERROR' || job.status === 'CANCELED') {
      const code = job.status === 'ERROR' && isMissingAudioError(job.errorMessage) ? 'no_audio' : safeCode(job.errorCode ?? job.status)
      await deps.query(
        `update public.learning_media_renditions
         set status = case when $2 = 'no_audio' and attempts < ${MAX_TRANSCODE_ATTEMPTS} then 'queued' else 'error' end,
             error_code = $2, updated_at = now()
         where source_path = $1 and job_id = $3`,
        [row.source_path, code, jobId],
      )
      failed += 1
    }
  }

  const [counts] = await deps.query(
    `select
       (select count(*) from public.learning_media_renditions where status = 'processing')::int as running,
       (select coalesce(sum(duration_seconds), 0) from public.learning_media_renditions where ready_at >= date_trunc('month', now()))::int as month_seconds`,
  )
  const running = Number(counts?.running ?? 0)
  const monthSeconds = Number(counts?.month_seconds ?? 0)
  const capSeconds = (deps.monthlyMinuteCap ?? DEFAULT_MONTHLY_TRANSCODE_MINUTES) * 60
  const slots = Math.max(0, MAX_CONCURRENT_TRANSCODES - running)
  if (monthSeconds >= capSeconds) {
    deps.log(`MEDIA_TRANSCODE_MONTHLY_CAP_REACHED month_minutes=${Math.floor(monthSeconds / 60)}`)
  } else if (slots > 0) {
    const queued = await deps.query(
      `select source_path, error_code from public.learning_media_renditions where status = 'queued' order by created_at limit $1`,
      [slots],
    )
    for (const row of queued) {
      const sourcePath = String(row.source_path)
      const [reference] = await deps.query(
        `select exists (select 1 from public.learning_courses where trailer_path = $1)
             or exists (select 1 from public.learning_lessons where asset_path = $1 and lesson_type = 'video') as referenced`,
        [sourcePath],
      )
      if (!reference?.referenced) {
        await deps.query(`update public.learning_media_renditions set status = 'unreferenced', updated_at = now() where source_path = $1 and status = 'queued'`, [sourcePath])
        continue
      }
      try {
        const job = buildTranscodeJob({ bucket: deps.bucket, sourcePath, roleArn: deps.roleArn, withAudio: row.error_code !== 'no_audio' })
        const { jobId } = await deps.createJob(job)
        await deps.query(
          `update public.learning_media_renditions
           set status = 'processing', job_id = $2, output_folder = $3, attempts = attempts + 1, updated_at = now()
           where source_path = $1 and status = 'queued'`,
          [sourcePath, jobId, renditionFolder(sourcePath)],
        )
        started += 1
      } catch (error) {
        await deps.query(
          `update public.learning_media_renditions set status = 'error', error_code = $2, attempts = attempts + 1, updated_at = now()
           where source_path = $1 and status = 'queued'`,
          [sourcePath, safeCode((error as { name?: string } | null)?.name ?? 'create_failed')],
        )
        failed += 1
      }
    }
  }
  if (completed || failed || started) deps.log(`MEDIA_TRANSCODE_SWEEP started=${started} completed=${completed} failed=${failed}`)
  return { started, completed, failed }
}
