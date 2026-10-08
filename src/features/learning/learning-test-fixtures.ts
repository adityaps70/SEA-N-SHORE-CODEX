import type { TestDatabase } from '@/lib/db/test-database'

/**
 * Test-only fixtures for the learning tables in a real (PGlite) database. Generic names only;
 * no real learner data. Never imported by application code.
 */

type Query = TestDatabase['query']

export async function createProfile(query: Query, name: string) {
  const rows = await query(
    `insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`,
    [name],
  )
  return rows[0]!.id as string
}

export async function createAdministrator(query: Query) {
  const id = await createProfile(query, 'Fixture Reviewer')
  await query(`insert into public.user_roles (user_id, role) values ($1, 'administrator')`, [id])
  return id
}

export async function createActiveMentor(query: Query) {
  const userId = await createProfile(query, 'Fixture Trainer')
  const reviewer = await createProfile(query, 'Fixture Approver')
  const application = await query(
    `insert into public.learning_mentor_applications (
       user_id, applicant_name, current_last_rank, years_experience, vessel_types, specialization,
       certifications, short_bio, proposed_course_topics, status
     ) values ($1, 'Fixture Trainer', 'Master Mariner', 20, '{Tanker}', 'Vetting and inspections',
       '{CoC Master}', 'A fixture trainer used by automated tests of the learning tables only.', '{SIRE 2.0}', 'approved')
     returning id`,
    [userId],
  )
  const mentor = await query(
    `insert into public.learning_mentors (user_id, application_id, status, approved_by)
     values ($1, $2, 'active', $3) returning id`,
    [userId, application[0]!.id, reviewer],
  )
  return { userId, mentorId: mentor[0]!.id as string }
}

export type FixtureCourse = {
  courseId: string
  slug: string
  sectionIds: string[]
  /** Lesson ids by key, e.g. lessons.intro. */
  lessons: Record<string, string>
  quiz: { quizId: string; questionIds: string[]; optionIds: string[][] } | null
  assignmentId: string | null
}

/**
 * A published course with two sections:
 * - Section A: intro (article), video (90% media rule), quiz (one question, two options)
 * - Section B: checklist (article), assignment, wrap-up (article)
 */
export async function createPublishedCourse(
  query: Query,
  mentor: { userId: string; mentorId: string },
  options: { slug?: string; priceMinor?: number; certificateEnabled?: boolean } = {},
): Promise<FixtureCourse> {
  const slug = options.slug ?? `fixture-course-${Math.random().toString(16).slice(2, 10)}`
  const priceMinor = options.priceMinor ?? 0
  const course = await query(
    `insert into public.learning_courses (
       mentor_id, created_by_user_id, slug, title, description, category, level, access_type, price_minor,
       currency, certificate_enabled, status, published_at, approved_at
     ) values ($1, $2, $3, 'Fixture SIRE Readiness', $4, 'Vetting & Inspections', 'intermediate', $5, $6,
       'INR', $7, 'published', now(), now())
     returning id`,
    [
      mentor.mentorId,
      mentor.userId,
      slug,
      'A fixture course used only by automated tests to exercise publishing and editing rules.',
      priceMinor > 0 ? 'paid' : 'free',
      priceMinor,
      options.certificateEnabled ?? true,
    ],
  )
  const courseId = course[0]!.id as string
  const sectionA = await query(
    `insert into public.learning_course_sections (course_id, title, position) values ($1, 'Section A', 0) returning id`,
    [courseId],
  )
  const sectionB = await query(
    `insert into public.learning_course_sections (course_id, title, position) values ($1, 'Section B', 1) returning id`,
    [courseId],
  )
  const sectionIds = [sectionA[0]!.id as string, sectionB[0]!.id as string]

  async function lesson(sectionId: string, position: number, title: string, type: string, extra: Record<string, unknown> = {}) {
    const record: Record<string, unknown> = {
      section_id: sectionId, position, title, lesson_type: type, completion_rule: 'manual', ...extra,
    }
    const columns = Object.keys(record)
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ')
    const rows = await query(
      `insert into public.learning_lessons (${columns.join(', ')}) values (${placeholders}) returning id`,
      Object.values(record),
    )
    return rows[0]!.id as string
  }

  const lessons: Record<string, string> = {
    intro: await lesson(sectionIds[0]!, 0, 'Intro', 'article', { article_body: 'Welcome to the course.' }),
    video: await lesson(sectionIds[0]!, 1, 'Walkthrough video', 'video', {
      asset_path: 'learning/fixture/video.mp4', duration_seconds: 600, completion_rule: 'media_percentage', completion_threshold: 90,
    }),
    quiz: await lesson(sectionIds[0]!, 2, 'Knowledge check', 'quiz', { completion_rule: 'quiz_pass', max_attempts: 3 }),
    checklist: await lesson(sectionIds[1]!, 0, 'Checklist', 'article', { article_body: 'Check these items.' }),
    assignment: await lesson(sectionIds[1]!, 1, 'Inspection report', 'assignment', { completion_rule: 'assignment_submit' }),
    wrapUp: await lesson(sectionIds[1]!, 2, 'Wrap-up', 'article', { article_body: 'Well done.' }),
  }

  const quizRow = await query(
    `insert into public.learning_quizzes (lesson_id, pass_percentage, instructions) values ($1, 70, 'Answer the question.') returning id`,
    [lessons.quiz],
  )
  const quizId = quizRow[0]!.id as string
  const question = await query(
    `insert into public.learning_quiz_questions (quiz_id, prompt, position) values ($1, 'Which document comes first?', 0) returning id`,
    [quizId],
  )
  const questionId = question[0]!.id as string
  const right = await query(
    `insert into public.learning_quiz_options (question_id, label, position, is_correct) values ($1, 'The VIQ', 0, true) returning id`,
    [questionId],
  )
  const wrong = await query(
    `insert into public.learning_quiz_options (question_id, label, position, is_correct) values ($1, 'The logbook', 1, false) returning id`,
    [questionId],
  )
  const assignment = await query(
    `insert into public.learning_assignments (lesson_id, instructions, accepted_extensions, max_upload_bytes)
     values ($1, 'Upload your inspection report.', '{.pdf}', 10485760) returning id`,
    [lessons.assignment],
  )

  return {
    courseId,
    slug,
    sectionIds,
    lessons,
    quiz: { quizId, questionIds: [questionId], optionIds: [[right[0]!.id as string, wrong[0]!.id as string]] },
    assignmentId: assignment[0]!.id as string,
  }
}

export async function enrollLearner(query: Query, courseId: string, label: string, enrolledDaysAgo = 0) {
  const learnerId = await createProfile(query, label)
  const rows = await query(
    `insert into public.learning_enrollments (course_id, learner_id, enrollment_source, status, enrolled_at)
     values ($1, $2, 'free', 'active', now() - make_interval(days => $3::int)) returning id`,
    [courseId, learnerId, enrolledDaysAgo],
  )
  return { learnerId, enrollmentId: rows[0]!.id as string }
}

export async function completeLessons(query: Query, enrollmentId: string, lessonIds: readonly string[]) {
  for (const lessonId of lessonIds) {
    await query(
      `insert into public.learning_progress (enrollment_id, lesson_id, completed, completed_at, viewed_at)
       values ($1, $2, true, now(), now())
       on conflict (enrollment_id, lesson_id) do update set completed = true, completed_at = now()`,
      [enrollmentId, lessonId],
    )
  }
}

/** Records a quiz attempt with one answer per question (the given options). */
export async function recordQuizAttempt(
  query: Query,
  input: { quizId: string; enrollmentId: string; learnerId: string; answers: Array<{ questionId: string; optionId: string; correctOptionId: string }> },
) {
  const score = input.answers.filter((answer) => answer.optionId === answer.correctOptionId).length
  const total = input.answers.length
  const attempt = await query(
    `insert into public.learning_quiz_attempts (quiz_id, enrollment_id, learner_id, score, total_questions, percentage, pass_percentage, passed, attempt_number)
     values ($1, $2, $3, $4, $5, $6, 70, $7, 1) returning id`,
    [input.quizId, input.enrollmentId, input.learnerId, score, total, Math.round((score / total) * 100), score / total >= 0.7],
  )
  for (const answer of input.answers) {
    await query(
      `insert into public.learning_quiz_attempt_answers (attempt_id, question_id, selected_option_id, correct_option_id, is_correct)
       values ($1, $2, $3, $4, $5)`,
      [attempt[0]!.id, answer.questionId, answer.optionId, answer.correctOptionId, answer.optionId === answer.correctOptionId],
    )
  }
  return attempt[0]!.id as string
}
