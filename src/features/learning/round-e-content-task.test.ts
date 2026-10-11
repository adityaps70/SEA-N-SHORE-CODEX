import { describe, expect, it, vi } from 'vitest'
import { ROUND_E_APPLY_CONFIRMATION, runRoundEContentApply, runRoundEContentPlan, type RoundEContentDeps } from './round-e-content-task'

const liveId = '11111111-1111-4111-8111-111111111111'
const revisionId = '22222222-2222-4222-8222-222222222222'
const articleId = '33333333-3333-4333-8333-333333333333'
const legacy = 'WHY THIS MATTERS\nInspectors look at evidence.\n- Review the VIQ'

function deps(options: { openRevision?: string | null; revisionPlainLeft?: number; status?: string } = {}) {
  const lines: string[] = []
  const calls: Array<{ text: string; values?: readonly unknown[] }> = []
  let converted = false
  const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
    calls.push({ text, values })
    if (text.includes('from public.learning_courses course') && text.includes('left join public.learning_mentors')) {
      return [{ id: liveId, status: options.status ?? 'published', user_id: 'trainer-1', mentor_status: 'active' }]
    }
    if (text.includes('revision_closed_at is null')) return options.openRevision ? [{ id: options.openRevision }] : []
    if (text.includes('from public.learning_quizzes')) return [{ module: 0, module_title: 'Module one', title: 'Quiz 1', shuffle_questions: false, shuffle_options: false }]
    if (text.includes('select course.slug, course.title')) {
      return [
        { slug: 'sire', title: 'SIRE 2.0', status: 'published', created_at: new Date('2026-09-01'), lessons: 37, enrollments: 12 },
        { slug: 'test-course', title: 'Test course', status: 'draft', created_at: new Date('2026-09-02'), lessons: 2, enrollments: 0 },
        { slug: 'empty', title: 'Bridge basics', status: 'draft', created_at: new Date('2026-09-03'), lessons: 0, enrollments: 0 },
      ]
    }
    if (text.includes("lesson.article_format = 'plain'") && text.includes('order by section.position')) {
      if (values?.[0] === revisionId) return converted ? Array.from({ length: options.revisionPlainLeft ?? 0 }, () => ({ id: 'x', title: 'x', article_body: 'x', article_format: 'plain' })) : []
      return [{ id: articleId, title: 'Reading', article_body: legacy, article_format: 'plain' }]
    }
    if (text.includes('lesson.lesson_type = \'video\'')) return [{ videos: 9, with_duration: 9, seconds: 5400, sire_videos: 9, sire_seconds: 5400 }]
    if (text.startsWith('select status from public.learning_courses')) return [{ status: 'draft' }]
    return []
  })
  const tx = vi.fn(async (text: string, values?: readonly unknown[]) => {
    calls.push({ text, values })
    converted = true
    return [{ id: 'draft-lesson' }]
  })
  const value: RoundEContentDeps = {
    query,
    transaction: async (work) => work(tx),
    startRevision: vi.fn(async () => ({ revisionCourseId: revisionId, created: true })),
    log: (line) => lines.push(line),
    siteUrl: 'https://seanshore.in',
  }
  return { value, lines, calls, tx }
}

describe('round E content task: plan', () => {
  it('reports shuffle settings, test-course candidates, the conversion dry run and video minutes, and writes nothing', async () => {
    const { value, lines, calls } = deps()
    await runRoundEContentPlan(value)
    expect(lines).toContain('ROUND_E_QUIZ module=1 module_title="Module one" quiz="Quiz 1" shuffle_questions=false shuffle_options=false')
    expect(lines).toContain('ROUND_E_QUIZZES total=1 with_shuffle_off=1')
    expect(lines.filter((line) => line.startsWith('ROUND_E_TEST_COURSE_CANDIDATE')).map((line) => /slug=(\S+).*reason=(\S+)/.exec(line)!.slice(1))).toEqual([
      ['test-course', 'name'],
      ['empty', 'no-materials'],
    ])
    expect(lines).toContainEqual(expect.stringMatching(new RegExp(`^ROUND_E_ARTICLE lesson=${articleId} title="Reading" words=\\d+ headings=1 paragraphs=1 lists=1 same_words=true sanitized=true$`)))
    expect(lines).toContain(`ROUND_E_ARTICLE_HEADING lesson=${articleId} text="Why This Matters"`)
    expect(lines).toContain('ROUND_E_VIDEO_STATS videos=9 with_duration=9 minutes=90 sire_videos=9 sire_minutes=90')
    expect(lines.at(-1)).toBe('ROUND_E_CONTENT_PLAN_ONLY_NO_APPLY')
    expect(calls.every((call) => /^\s*select/i.test(call.text))).toBe(true)
    expect(value.startRevision).not.toHaveBeenCalled()
  })
})

describe('round E content task: apply-once', () => {
  it('refuses without the confirmation phrase', async () => {
    const { value } = deps()
    await expect(runRoundEContentApply(value, 'yes')).rejects.toThrow('confirmation')
    expect(value.startRevision).not.toHaveBeenCalled()
  })

  it('opens a draft as the trainer and converts only the draft copies of the plain-text articles', async () => {
    const { value, lines, tx } = deps()
    await runRoundEContentApply(value, ROUND_E_APPLY_CONFIRMATION)
    expect(value.startRevision).toHaveBeenCalledWith('trainer-1', liveId)
    expect(tx).toHaveBeenCalledTimes(1)
    const [text, values] = tx.mock.calls[0]!
    expect(text).toContain('lesson.revision_source_id = $2')
    expect(values?.[0]).toBe(revisionId)
    expect(values?.[1]).toBe(articleId)
    expect(String(values?.[2])).toContain('<h2>Why This Matters</h2>')
    expect(values?.[3]).toBe(legacy)
    expect(lines).toContain(`ROUND_E_DRAFT_REVISION id=${revisionId} converted=1 url=https://seanshore.in/learn/studio/courses/${revisionId}/changes`)
    expect(lines.at(-1)).toBe('ROUND_E_CONTENT_APPLY_VERIFIED=true')
  })

  it('leaves an already open draft alone', async () => {
    const { value, lines, tx } = deps({ openRevision: revisionId })
    await runRoundEContentApply(value, ROUND_E_APPLY_CONFIRMATION)
    expect(value.startRevision).not.toHaveBeenCalled()
    expect(tx).not.toHaveBeenCalled()
    expect(lines.at(-1)).toBe('ROUND_E_CONTENT_ALREADY_APPLIED=true')
  })

  it('refuses a course that is not published', async () => {
    const { value } = deps({ status: 'draft' })
    await expect(runRoundEContentApply(value, ROUND_E_APPLY_CONFIRMATION)).rejects.toThrow('not published')
  })

  it('fails when plain-text articles remain in the draft', async () => {
    const { value } = deps({ revisionPlainLeft: 1 })
    await expect(runRoundEContentApply(value, ROUND_E_APPLY_CONFIRMATION)).rejects.toThrow('remain in the draft')
  })
})
