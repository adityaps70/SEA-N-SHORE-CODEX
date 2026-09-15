import { describe, expect, it } from 'vitest'
import { createLearnerCourseRepository } from './learner-course-repository'

const learnerId = '11111111-1111-4111-8111-111111111111'
const enrollmentId = '22222222-2222-4222-8222-222222222222'
const courseId = '33333333-3333-4333-8333-333333333333'
const sectionOneId = '44444444-4444-4444-8444-444444444444'
const sectionTwoId = '55555555-5555-4555-8555-555555555555'
const lessonOneId = '66666666-6666-4666-8666-666666666666'
const lessonTwoId = '77777777-7777-4777-8777-777777777777'
const slug = 'sire-2-readiness-for-tanker-officers'

const baseRow = {
  enrollment_id: enrollmentId,
  enrollment_status: 'active',
  enrolled_at: new Date('2026-09-10T08:00:00.000Z'),
  course_id: courseId,
  slug,
  title: 'SIRE 2.0 Readiness for Tanker Officers',
  subtitle: 'Practical inspection readiness from a Master Mariner',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  course_format: 'recorded',
  certificate_enabled: true,
  navigation_mode: 'free',
  mentor_name: 'Capt. Maya Singh',
}

function materialControls(overrides: Record<string, unknown> = {}) {
  return {
    is_published: true,
    release_mode: 'immediate',
    release_at: null,
    drip_delay_days: null,
    prerequisite_lesson_id: null,
    prerequisite_completed: null,
    completion_rule: 'manual',
    completion_threshold: null,
    max_attempts: null,
    embed_kind: null,
    viewed_at: null,
    media_percent: 0,
    attempts_used: 0,
    ...overrides,
  }
}

describe('learner course repository', () => {
  it('loads native material controls and progress for an enrolled learner', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createLearnerCourseRepository({
      now: () => new Date('2026-09-15T12:00:00.000Z'),
      query: async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        return [
          {
            ...baseRow,
            section_id: sectionOneId,
            section_title: 'Inspection foundations',
            section_position: 0,
            lesson_id: lessonOneId,
            lesson_title: 'How SIRE 2.0 changes readiness',
            lesson_type: 'article',
            lesson_position: 0,
            lesson_summary: 'Understand the inspection model before going deeper.',
            article_body: 'SIRE 2.0 uses a risk-based inspection framework.',
            asset_path: null,
            external_url: null,
            duration_seconds: null,
            is_downloadable: false,
            completed: true,
            completed_at: new Date('2026-09-15T08:30:00.000Z'),
            last_position_seconds: 0,
            ...materialControls(),
          },
          {
            ...baseRow,
            section_id: sectionTwoId,
            section_title: 'Operational readiness',
            section_position: 1,
            lesson_id: lessonTwoId,
            lesson_title: 'Bridge readiness walkthrough',
            lesson_type: 'video',
            lesson_position: 0,
            lesson_summary: null,
            article_body: null,
            asset_path: 'learning/courses/sire-2/bridge-readiness.mp4',
            external_url: null,
            duration_seconds: 780,
            is_downloadable: false,
            completed: false,
            completed_at: null,
            last_position_seconds: 125,
            ...materialControls({ completion_rule: 'media_percentage', completion_threshold: 90, media_percent: 22 }),
          },
        ]
      },
    })

    const course = await repository.getLearnerCourse(learnerId, slug)
    expect(course).not.toBeNull()
    expect(course).toMatchObject({
      enrollmentId,
      enrollmentStatus: 'active',
      courseId,
      slug,
      navigationMode: 'free',
      totalLessons: 2,
      completedLessons: 1,
      progressPercent: 50,
    })
    expect(course?.sections[0]?.lessons[0]).toMatchObject({
      id: lessonOneId,
      lessonType: 'article',
      isAvailable: true,
      lockReason: null,
      completionRule: 'manual',
      completed: true,
    })
    expect(course?.sections[1]?.lessons[0]).toMatchObject({
      id: lessonTwoId,
      lessonType: 'video',
      assetPath: 'learning/courses/sire-2/bridge-readiness.mp4',
      isAvailable: true,
      completionRule: 'media_percentage',
      completionThreshold: 90,
      mediaPercent: 22,
      lastPositionSeconds: 125,
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.values).toEqual([learnerId, slug])
    expect(seen[0]?.text).toContain("course.status = 'published'")
    expect(seen[0]?.text).toContain("mentor.status = 'active'")
    expect(seen[0]?.text).toContain("application.status = 'approved'")
    expect(seen[0]?.text).toContain('lesson.prerequisite_lesson_id')
  })

  it('redacts protected content when a scheduled material is still locked', async () => {
    const repository = createLearnerCourseRepository({
      now: () => new Date('2026-09-15T12:00:00.000Z'),
      query: async () => [{
        ...baseRow,
        section_id: sectionOneId,
        section_title: 'Inspection foundations',
        section_position: 0,
        lesson_id: lessonOneId,
        lesson_title: 'Restricted walkthrough',
        lesson_type: 'video',
        lesson_position: 0,
        lesson_summary: 'Available tomorrow',
        article_body: null,
        asset_path: 'learning/private/future.mp4',
        external_url: 'https://example.com/private',
        duration_seconds: 300,
        is_downloadable: false,
        completed: false,
        completed_at: null,
        last_position_seconds: 0,
        ...materialControls({
          release_mode: 'scheduled',
          release_at: new Date('2026-09-16T12:00:00.000Z'),
          completion_rule: 'media_percentage',
          completion_threshold: 90,
        }),
      }],
    })

    const material = (await repository.getLearnerCourse(learnerId, slug))?.sections[0]?.lessons[0]
    expect(material).toMatchObject({ isAvailable: false, lockReason: 'scheduled' })
    expect(material?.assetPath).toBeNull()
    expect(material?.externalUrl).toBeNull()
    expect(material?.articleBody).toBeNull()
  })

  it('applies implicit previous-material prerequisites in sequential mode', async () => {
    const repository = createLearnerCourseRepository({
      now: () => new Date('2026-09-15T12:00:00.000Z'),
      query: async () => [
        {
          ...baseRow,
          navigation_mode: 'sequential',
          section_id: sectionOneId,
          section_title: 'Module',
          section_position: 0,
          lesson_id: lessonOneId,
          lesson_title: 'First',
          lesson_type: 'article',
          lesson_position: 0,
          lesson_summary: null,
          article_body: 'First content',
          asset_path: null,
          external_url: null,
          duration_seconds: null,
          is_downloadable: false,
          completed: false,
          completed_at: null,
          last_position_seconds: 0,
          ...materialControls(),
        },
        {
          ...baseRow,
          navigation_mode: 'sequential',
          section_id: sectionOneId,
          section_title: 'Module',
          section_position: 0,
          lesson_id: lessonTwoId,
          lesson_title: 'Second',
          lesson_type: 'article',
          lesson_position: 1,
          lesson_summary: null,
          article_body: 'Second private content',
          asset_path: null,
          external_url: null,
          duration_seconds: null,
          is_downloadable: false,
          completed: false,
          completed_at: null,
          last_position_seconds: 0,
          ...materialControls(),
        },
      ],
    })

    const lessons = (await repository.getLearnerCourse(learnerId, slug))?.sections[0]?.lessons ?? []
    expect(lessons[0]?.isAvailable).toBe(true)
    expect(lessons[1]).toMatchObject({ isAvailable: false, lockReason: 'prerequisite', articleBody: null })
  })

  it('fails closed when the learner has no visible enrollment for the published course', async () => {
    const repository = createLearnerCourseRepository({ query: async () => [] })
    await expect(repository.getLearnerCourse(learnerId, slug)).resolves.toBeNull()
  })
})
