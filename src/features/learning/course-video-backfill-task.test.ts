// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { runCourseVideoBackfillPlan, runCourseVideoBackfillQueue, type CourseVideoBackfillDeps } from './course-video-backfill-task'

const LESSON = 'learning/u1/33333333-3333-4333-8333-333333333333/lesson_video/44444444-4444-4444-8444-444444444444.mp4'
const TRAILER = 'learning/u1/33333333-3333-4333-8333-333333333333/course_trailer/55555555-5555-4555-8555-555555555555.mp4'

function deps(input: { table: boolean; paths: string[]; sizes?: Record<string, number> }) {
  const lines: string[] = []
  const inserts: unknown[][] = []
  const value: CourseVideoBackfillDeps = {
    query: vi.fn(async (sql: string, values: readonly unknown[] = []) => {
      if (sql.includes('to_regclass')) return [{ present: input.table }]
      if (sql.includes('insert into public.learning_media_renditions')) {
        inserts.push([...values])
        return [{ source_path: values[0] }]
      }
      return input.paths.map((path) => ({ path }))
    }),
    head: async (key) => {
      const size = input.sizes?.[key]
      if (size === undefined) throw new Error('missing')
      return { contentLength: size }
    },
    log: (line) => lines.push(line),
  }
  return { deps: value, lines, inserts }
}

describe('course video backfill', () => {
  it('plans with counts, size and a cost range only, even before the renditions table exists', async () => {
    const { deps: value, lines, inserts } = deps({ table: false, paths: [LESSON, TRAILER, 'learning/u/c/lesson_audio/a.mp3'], sizes: { [LESSON]: 225_000_000, [TRAILER]: 0 } })
    await runCourseVideoBackfillPlan(value)
    expect(inserts).toEqual([])
    expect(lines[0]).toBe('MEDIA_TRANSCODE_BACKFILL_PLAN videos=2 trailers=1 lesson_videos=1 not_in_bucket=0 total_mb=215 rendition_table=missing')
    // 225 MB = 1,800 Mbit: 10 minutes at 3 Mbit/s up to 30 minutes at 1 Mbit/s, at US$0.0375 a source minute.
    expect(lines[1]).toBe('MEDIA_TRANSCODE_BACKFILL_ESTIMATE minutes=10-30 usd=0.38-1.13 inr=33-99 monthly_cap_minutes=240')
    expect(lines.at(-1)).toBe('MEDIA_TRANSCODE_BACKFILL_PLAN_VERIFIED=true')
    expect(lines.join('\n')).not.toContain('learning/')
  })

  it('queues exactly the videos without a rendition, and refuses before the table exists', async () => {
    const { deps: value, lines, inserts } = deps({ table: true, paths: [LESSON, TRAILER] })
    await runCourseVideoBackfillQueue(value)
    expect(inserts).toEqual([[LESSON, 'lesson_video'], [TRAILER, 'course_trailer']])
    expect(lines).toEqual(['MEDIA_TRANSCODE_BACKFILL_QUEUED videos=2', 'MEDIA_TRANSCODE_BACKFILL_QUEUE_VERIFIED=true'])
    await expect(runCourseVideoBackfillQueue(deps({ table: false, paths: [LESSON] }).deps)).rejects.toThrow('media_renditions_table_missing')
  })
})
