import type { QueryResultRow } from 'pg'
import { sanitizeArticleHtml } from './article-html'
import { convertLegacyArticle } from './legacy-article-conversion'
import { articleText, sameWordsIgnoringCase } from './text-diff'

/**
 * Learning round E: the one-off content task behind the guarded `learning-round-e-content` runner. It runs once as an
 * ECS task from the deployed image (dist/workers/learning-round-e-content.mjs).
 *
 * plan (read only) prints:
 * - the SIRE course's quizzes with shuffling off (settings are reported, never changed);
 * - test-course candidates (titles, slugs and counts only; nothing is deleted);
 * - a dry run of the SIRE plain-text article conversion (E5), with a same-words check per article;
 * - video counts and minutes, for the HLS and captions cost notes.
 * apply-once opens a draft revision of the SIRE course as its trainer (the Round A1 flow, so material ids stay
 * stable) and writes the converted articles into that draft only. Nothing is submitted or published.
 *
 * No learner names, emails or answers are read or printed; enrolment numbers are counts.
 */

export const SIRE_COURSE_SLUG = 'sire-2-0-practical-vessel-inspection-readiness'
export const ROUND_E_APPLY_CONFIRMATION = 'I_APPROVE_ROUND_E_SIRE_DRAFT_REVISION'
const TEST_COURSE_PATTERN = /\b(test|tests|testing|e2e|demo|sample|fixture|dummy|untitled|asdf|qwerty|lorem|tmp|temp|trial course)\b/i

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export type RoundEContentDeps = {
  query: Query
  transaction: Transaction
  startRevision: (actorId: string, liveCourseId: string) => Promise<{ revisionCourseId: string; created: boolean }>
  log: (line: string) => void
  siteUrl: string
}

function quote(text: unknown) {
  return JSON.stringify(String(text ?? '').replace(/\s+/g, ' ').trim())
}

type ArticleRow = QueryResultRow & { id: string; title: string; article_body: string | null; article_format: string }

export type PlannedConversion = {
  lessonId: string
  title: string
  original: string
  html: string
  headings: string[]
  paragraphs: number
  lists: number
  words: number
  sameWords: boolean
  sanitized: boolean
}

export function planConversion(row: ArticleRow): PlannedConversion {
  const original = row.article_body ?? ''
  const converted = convertLegacyArticle(original)
  const before = articleText(original, 'plain')
  return {
    lessonId: row.id,
    title: row.title,
    original,
    html: converted.html,
    headings: converted.headings,
    paragraphs: converted.paragraphs,
    lists: converted.lists,
    words: before ? before.split(/\s+/).length : 0,
    sameWords: sameWordsIgnoringCase(before, articleText(converted.html, 'html')),
    sanitized: sanitizeArticleHtml(converted.html) === converted.html,
  }
}

async function liveSireCourse(query: Query) {
  const rows = await query(
    `select course.id, course.status, mentor.user_id, mentor.status as mentor_status
     from public.learning_courses course
     left join public.learning_mentors mentor on mentor.id = course.mentor_id
     where course.slug = $1 and course.revision_of_course_id is null`,
    [SIRE_COURSE_SLUG],
  ) as Array<QueryResultRow & { id: string; status: string; user_id: string | null; mentor_status: string | null }>
  if (rows.length !== 1) throw new Error(`Expected one live SIRE course; found ${rows.length}.`)
  return rows[0]!
}

async function plainArticles(query: Query, courseId: string) {
  return await query(
    `select lesson.id, lesson.title, lesson.article_body, lesson.article_format
     from public.learning_lessons lesson
     inner join public.learning_course_sections section on section.id = lesson.section_id
     where section.course_id = $1
       and section.removed_at is null
       and lesson.removed_at is null
       and lesson.lesson_type = 'article'
       and lesson.article_format = 'plain'
       and coalesce(btrim(lesson.article_body), '') <> ''
     order by section.position, lesson.position`,
    [courseId],
  ) as ArticleRow[]
}

async function openRevision(query: Query, liveCourseId: string) {
  const rows = await query(
    `select id from public.learning_courses where revision_of_course_id = $1 and revision_closed_at is null limit 1`,
    [liveCourseId],
  ) as Array<QueryResultRow & { id: string }>
  return rows[0]?.id ?? null
}

export async function runRoundEContentPlan(deps: RoundEContentDeps) {
  const { query, log } = deps
  log('ROUND_E_CONTENT_MODE=plan')
  const course = await liveSireCourse(query)
  const open = await openRevision(query, course.id)
  log(`ROUND_E_SIRE_COURSE status=${course.status} trainer_active=${course.mentor_status === 'active'} open_revision=${open ?? 'none'}`)

  // 1. The SIRE quizzes and their shuffle settings (reported, never changed).
  const quizzes = await query(
    `select section.position as module, section.title as module_title, lesson.title, quiz.shuffle_questions, quiz.shuffle_options
     from public.learning_quizzes quiz
     inner join public.learning_lessons lesson on lesson.id = quiz.lesson_id
     inner join public.learning_course_sections section on section.id = lesson.section_id
     where section.course_id = $1 and section.removed_at is null and lesson.removed_at is null
     order by section.position, lesson.position`,
    [course.id],
  )
  for (const quiz of quizzes) {
    log(`ROUND_E_QUIZ module=${Number(quiz.module) + 1} module_title=${quote(quiz.module_title)} quiz=${quote(quiz.title)} shuffle_questions=${quiz.shuffle_questions === true} shuffle_options=${quiz.shuffle_options === true}`)
  }
  const shuffleOff = quizzes.filter((quiz) => quiz.shuffle_questions !== true || quiz.shuffle_options !== true).length
  log(`ROUND_E_QUIZZES total=${quizzes.length} with_shuffle_off=${shuffleOff}`)

  // 2. Test-course candidates: live courses (not draft copies) named like a test, or with no materials at all.
  const courses = await query(
    `select course.slug, course.title, course.status, course.created_at,
       (select count(*) from public.learning_lessons lesson inner join public.learning_course_sections section on section.id = lesson.section_id
         where section.course_id = course.id and lesson.removed_at is null)::bigint as lessons,
       (select count(*) from public.learning_enrollments enrollment where enrollment.course_id = course.id)::bigint as enrollments
     from public.learning_courses course
     where course.revision_of_course_id is null and course.removed_at is null
     order by course.created_at`,
  )
  let candidates = 0
  for (const row of courses) {
    const named = TEST_COURSE_PATTERN.test(`${row.title} ${row.slug}`)
    const empty = Number(row.lessons) === 0
    if (!named && !empty) continue
    candidates += 1
    const created = row.created_at instanceof Date ? row.created_at.toISOString().slice(0, 10) : String(row.created_at).slice(0, 10)
    log(`ROUND_E_TEST_COURSE_CANDIDATE slug=${row.slug} title=${quote(row.title)} status=${row.status} lessons=${row.lessons} enrollments=${row.enrollments} created=${created} reason=${named ? 'name' : 'no-materials'}`)
  }
  log(`ROUND_E_TEST_COURSES courses=${courses.length} candidates=${candidates} (nothing deleted)`)

  // 3. A dry run of the article conversion.
  const articles = (await plainArticles(query, course.id)).map(planConversion)
  for (const article of articles) {
    log(`ROUND_E_ARTICLE lesson=${article.lessonId} title=${quote(article.title)} words=${article.words} headings=${article.headings.length} paragraphs=${article.paragraphs} lists=${article.lists} same_words=${article.sameWords} sanitized=${article.sanitized}`)
    for (const heading of article.headings.slice(0, 12)) log(`ROUND_E_ARTICLE_HEADING lesson=${article.lessonId} text=${quote(heading)}`)
  }
  const unsafe = articles.filter((article) => !article.sameWords || !article.sanitized).length
  log(`ROUND_E_ARTICLES plain=${articles.length} would_convert=${articles.length - unsafe} refused=${unsafe}`)

  // 4. Video minutes for the cost notes (lesson durations as entered by trainers).
  const videos = await query(
    `select count(*)::bigint as videos, count(lesson.duration_seconds)::bigint as with_duration,
       coalesce(sum(lesson.duration_seconds), 0)::bigint as seconds,
       count(*) filter (where section.course_id = $1)::bigint as sire_videos,
       coalesce(sum(lesson.duration_seconds) filter (where section.course_id = $1), 0)::bigint as sire_seconds
     from public.learning_lessons lesson
     inner join public.learning_course_sections section on section.id = lesson.section_id
     inner join public.learning_courses course on course.id = section.course_id
     where lesson.lesson_type = 'video' and lesson.asset_path is not null and lesson.removed_at is null
       and course.revision_of_course_id is null and course.removed_at is null`,
    [course.id],
  )
  const stats = videos[0] ?? {}
  log(`ROUND_E_VIDEO_STATS videos=${stats.videos ?? 0} with_duration=${stats.with_duration ?? 0} minutes=${Math.round(Number(stats.seconds ?? 0) / 60)} sire_videos=${stats.sire_videos ?? 0} sire_minutes=${Math.round(Number(stats.sire_seconds ?? 0) / 60)}`)

  log('ROUND_E_CONTENT_PLAN_VERIFIED=true')
  log('ROUND_E_CONTENT_PLAN_ONLY_NO_APPLY')
}

export async function runRoundEContentApply(deps: RoundEContentDeps, confirmation: string | undefined) {
  const { query, transaction, startRevision, log, siteUrl } = deps
  if (confirmation !== ROUND_E_APPLY_CONFIRMATION) throw new Error('The apply confirmation phrase is missing.')
  log('ROUND_E_CONTENT_MODE=apply-once')
  const course = await liveSireCourse(query)
  if (course.status !== 'published') throw new Error(`The SIRE course is ${course.status}, not published; refusing.`)
  if (!course.user_id || course.mentor_status !== 'active') throw new Error('The SIRE course has no active trainer; refusing.')

  const existing = await openRevision(query, course.id)
  if (existing) {
    // Someone (the trainer, or an earlier run) already has a draft open: leave it alone.
    log(`ROUND_E_OPEN_REVISION_EXISTS id=${existing} url=${siteUrl}/learn/studio/courses/${existing}/changes`)
    log('ROUND_E_CONTENT_ALREADY_APPLIED=true')
    return
  }

  const planned = (await plainArticles(query, course.id)).map(planConversion)
  const refused = planned.filter((article) => !article.sameWords || !article.sanitized)
  if (refused.length) throw new Error(`Refusing: ${refused.length} article(s) would change wording or lose markup (${refused.map((article) => article.lessonId).join(', ')}).`)
  if (!planned.length) throw new Error('No plain-text articles to convert; refusing to open an empty draft.')

  const { revisionCourseId, created } = await startRevision(course.user_id, course.id)
  if (!created) throw new Error('A draft revision appeared while this task ran; refusing to write into it.')
  log(`ROUND_E_DRAFT_REVISION_OPENED id=${revisionCourseId}`)

  await transaction(async (tx) => {
    for (const article of planned) {
      const updated = await tx(
        `update public.learning_lessons lesson
         set article_body = $3, article_format = 'html', updated_at = now()
         from public.learning_course_sections section
         where section.id = lesson.section_id
           and section.course_id = $1
           and lesson.revision_source_id = $2
           and lesson.lesson_type = 'article'
           and lesson.article_format = 'plain'
           and lesson.article_body = $4
         returning lesson.id`,
        [revisionCourseId, article.lessonId, article.html, article.original],
      )
      if (updated.length !== 1) throw new Error(`Expected to convert one draft copy of ${article.lessonId}; matched ${updated.length}.`)
      log(`ROUND_E_ARTICLE_CONVERTED lesson=${article.lessonId} headings=${article.headings.length} paragraphs=${article.paragraphs} lists=${article.lists}`)
    }
  })

  const left = await plainArticles(query, revisionCourseId)
  if (left.length) throw new Error(`${left.length} plain-text article(s) remain in the draft after the conversion.`)
  const status = await query(`select status from public.learning_courses where id = $1`, [revisionCourseId])
  if (status[0]?.status !== 'draft') throw new Error('The draft revision is not a draft after the conversion.')
  log(`ROUND_E_DRAFT_REVISION id=${revisionCourseId} converted=${planned.length} url=${siteUrl}/learn/studio/courses/${revisionCourseId}/changes`)
  log('ROUND_E_CONTENT_APPLY_VERIFIED=true')
}
