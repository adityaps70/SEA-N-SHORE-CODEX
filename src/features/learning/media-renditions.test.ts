// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mediaCdnId } from '@/lib/media-cdn/cdn-keys'
import {
  buildTranscodeJob,
  enqueueRendition,
  readyRenditionPaths,
  renditionFolder,
  renditionKindForPath,
  renditionSources,
  runTranscodeSweep,
  type TranscodeSweepDeps,
} from './media-renditions'

const LESSON = 'learning/u1/33333333-3333-4333-8333-333333333333/lesson_video/44444444-4444-4444-8444-444444444444.mp4'
const TRAILER = 'learning/u1/33333333-3333-4333-8333-333333333333/course_trailer/55555555-5555-4555-8555-555555555555.mp4'

describe('course video renditions', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('knows which uploads are course videos', () => {
    expect(renditionKindForPath(LESSON)).toBe('lesson_video')
    expect(renditionKindForPath(TRAILER)).toBe('course_trailer')
    expect(renditionKindForPath('learning/u1/c/lesson_audio/a.mp3')).toBeNull()
    expect(renditionFolder(LESSON)).toBe(`m/v/${mediaCdnId(LESSON)}`)
  })

  it('builds a Basic-tier job: 720p MP4 and HLS 360p/720p under the video folder, never upscaled', () => {
    const job = buildTranscodeJob({ bucket: 'media-bucket', sourcePath: LESSON, roleArn: 'arn:aws:iam::310356785722:role/mc', withAudio: true })
    const folder = renditionFolder(LESSON)
    expect(job.Role).toBe('arn:aws:iam::310356785722:role/mc')
    expect(job.Settings.Inputs[0]!.FileInput).toBe(`s3://media-bucket/${LESSON}`)
    const [mp4, hls] = job.Settings.OutputGroups
    expect(mp4!.OutputGroupSettings).toEqual({ Type: 'FILE_GROUP_SETTINGS', FileGroupSettings: { Destination: `s3://media-bucket/${folder}/mp4/video` } })
    expect(mp4!.Outputs.map((output) => [output.NameModifier, output.VideoDescription.Width, output.VideoDescription.Height])).toEqual([['-720p', 1280, 720]])
    expect(hls!.OutputGroupSettings.HlsGroupSettings!.Destination).toBe(`s3://media-bucket/${folder}/hls/master`)
    expect(hls!.Outputs.map((output) => [output.NameModifier, output.VideoDescription.Height])).toEqual([['_720p', 720], ['_360p', 360]])
    type Output = { VideoDescription: { ScalingBehavior: string; CodecSettings: { H264Settings: { QualityTuningLevel: string } } }; AudioDescriptions?: Array<{ CodecSettings: { Codec: string } }> }
    for (const output of [...mp4!.Outputs, ...hls!.Outputs] as Output[]) {
      expect(output.VideoDescription.ScalingBehavior).toBe('FIT_NO_UPSCALE')
      expect(output.VideoDescription.CodecSettings.H264Settings.QualityTuningLevel).toBe('SINGLE_PASS')
      expect(output.AudioDescriptions?.[0]?.CodecSettings.Codec).toBe('AAC')
    }
    const silent = buildTranscodeJob({ bucket: 'media-bucket', sourcePath: LESSON, roleArn: 'arn:aws:iam::310356785722:role/mc', withAudio: false })
    expect(silent.Settings.Inputs[0]).not.toHaveProperty('AudioSelectors')
    const silentOutputs = silent.Settings.OutputGroups.map((group) => group.Outputs as readonly object[]).flat()
    expect(silentOutputs.every((output) => !('AudioDescriptions' in output))).toBe(true)
  })

  it('signs one query for the whole rendition folder, short for lessons and long for trailers', () => {
    const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    Object.assign(process.env, { MEDIA_CDN_SIGNING_KEY: pem, MEDIA_CDN_KEY_PAIR_ID: 'K2JCJMDEHXQW5F', NEXT_PUBLIC_SITE_URL: 'https://seanshore.in' })
    const now = Date.UTC(2026, 9, 26, 3)
    const lesson = renditionSources(LESSON, now)!
    const folder = renditionFolder(LESSON)
    expect(lesson.hls.startsWith(`/${folder}/hls/master.m3u8?Policy=`)).toBe(true)
    expect(lesson.mp4.startsWith(`/${folder}/mp4/video-720p.mp4?Policy=`)).toBe(true)
    expect(lesson.hls.split('?')[1]).toBe(lesson.mp4.split('?')[1])
    const lessonHours = (Date.parse(lesson.expiresAt) - now) / 3_600_000
    expect(lessonHours).toBeGreaterThan(1)
    expect(lessonHours).toBeLessThanOrEqual(2)
    const trailerDays = (Date.parse(renditionSources(TRAILER, now)!.expiresAt) - now) / 86_400_000
    expect(trailerDays).toBeGreaterThan(30)
    delete process.env.MEDIA_CDN_SIGNING_KEY
    expect(renditionSources(LESSON, now)).toBeNull()
  })

  it('queues only course videos, once, and reads ready ones without failing the page', async () => {
    const query = vi.fn(async () => [] as Array<Record<string, unknown>>)
    await enqueueRendition(query, LESSON)
    await enqueueRendition(query, 'learning/u1/c/lesson_audio/a.mp3')
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]).toEqual([expect.stringContaining('on conflict (source_path) do nothing'), [LESSON, 'lesson_video']])

    const ready = vi.fn(async () => [{ source_path: LESSON }])
    expect(await readyRenditionPaths(ready, [LESSON, TRAILER, 'x'])).toEqual(new Set([LESSON]))
    expect(await readyRenditionPaths(async () => { throw new Error('relation does not exist') }, [LESSON])).toEqual(new Set())
  })
})

function sweepDeps(state: {
  processing?: Array<{ source_path: string; job_id: string }>
  queued?: Array<{ source_path: string; error_code?: string | null }>
  running?: number
  monthSeconds?: number
  referenced?: boolean
}) {
  const writes: Array<{ sql: string; values: readonly unknown[] }> = []
  const deps: TranscodeSweepDeps = {
    query: async (sql, values = []) => {
      if (sql.includes("where status = 'processing' order by")) return state.processing ?? []
      if (sql.includes('as month_seconds')) return [{ running: state.running ?? 0, month_seconds: state.monthSeconds ?? 0 }]
      if (sql.includes("where status = 'queued' order by")) return (state.queued ?? []).slice(0, Number(values[0]))
      if (sql.includes('as referenced')) return [{ referenced: state.referenced ?? true }]
      writes.push({ sql, values })
      return []
    },
    createJob: vi.fn(async () => ({ jobId: 'job-new' })),
    getJob: vi.fn(async () => ({ status: 'PROGRESSING' })),
    bucket: 'media-bucket',
    roleArn: 'arn:aws:iam::310356785722:role/mc',
    monthlyMinuteCap: 240,
    log: vi.fn(),
  }
  return { deps, writes }
}

describe('transcode sweep', () => {
  it('marks a finished job ready with its duration and a failed one as an error', async () => {
    const { deps, writes } = sweepDeps({ processing: [{ source_path: LESSON, job_id: 'job-1' }, { source_path: TRAILER, job_id: 'job-2' }] })
    deps.getJob = vi.fn(async (jobId: string) => jobId === 'job-1'
      ? { status: 'COMPLETE', durationMs: 125_400 }
      : { status: 'ERROR', errorCode: 1030, errorMessage: 'Bad input' })
    const result = await runTranscodeSweep(deps)
    expect(result).toEqual({ started: 0, completed: 1, failed: 1 })
    expect(writes[0]!.sql).toContain("set status = 'ready'")
    expect(writes[0]!.values).toEqual([LESSON, 125, 'job-1'])
    expect(writes[1]!.values).toEqual([TRAILER, '1030', 'job-2'])
  })

  it('tries a video without an audio track once more without audio', async () => {
    const { deps, writes } = sweepDeps({ processing: [{ source_path: LESSON, job_id: 'job-1' }] })
    deps.getJob = vi.fn(async () => ({ status: 'ERROR', errorCode: 1040, errorMessage: 'No audio track found in the input' }))
    await runTranscodeSweep(deps)
    expect(writes[0]!.values).toEqual([LESSON, 'no_audio', 'job-1'])
    expect(writes[0]!.sql).toContain("when $2 = 'no_audio' and attempts < 2 then 'queued'")

    const retry = sweepDeps({ queued: [{ source_path: LESSON, error_code: 'no_audio' }] })
    await runTranscodeSweep(retry.deps)
    const job = (retry.deps.createJob as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(job.Settings.Inputs[0]).not.toHaveProperty('AudioSelectors')
  })

  it('starts at most two jobs at a time and records them', async () => {
    const { deps, writes } = sweepDeps({ running: 1, queued: [{ source_path: LESSON }, { source_path: TRAILER }] })
    const result = await runTranscodeSweep(deps)
    expect(result.started).toBe(1)
    expect(deps.createJob).toHaveBeenCalledTimes(1)
    expect(writes[0]!.sql).toContain("set status = 'processing'")
    expect(writes[0]!.values).toEqual([LESSON, 'job-new', renditionFolder(LESSON)])
  })

  it('starts nothing once the month reaches its minute cap', async () => {
    const { deps } = sweepDeps({ monthSeconds: 240 * 60, queued: [{ source_path: LESSON }] })
    await runTranscodeSweep(deps)
    expect(deps.createJob).not.toHaveBeenCalled()
    expect(deps.log).toHaveBeenCalledWith('MEDIA_TRANSCODE_MONTHLY_CAP_REACHED month_minutes=240')
  })

  it('never transcodes a video no course or lesson uses any more', async () => {
    const { deps, writes } = sweepDeps({ queued: [{ source_path: LESSON }], referenced: false })
    await runTranscodeSweep(deps)
    expect(deps.createJob).not.toHaveBeenCalled()
    expect(writes[0]!.sql).toContain("set status = 'unreferenced'")
  })

  it('records a job MediaConvert refused as an error without retrying it', async () => {
    const { deps, writes } = sweepDeps({ queued: [{ source_path: LESSON }] })
    deps.createJob = vi.fn(async () => { throw Object.assign(new Error('denied'), { name: 'ForbiddenException' }) })
    const result = await runTranscodeSweep(deps)
    expect(result.failed).toBe(1)
    expect(writes[0]!.values).toEqual([LESSON, 'ForbiddenException'])
  })
})
