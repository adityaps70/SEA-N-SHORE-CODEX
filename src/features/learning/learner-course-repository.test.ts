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
  course_id: courseId,
  slug,
  title: 'SIRE 2.0 Readiness for Tanker Officers',
  subtitle: 'Practical inspection readiness from a Master Mariner',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  course_format: 'recorded',
  certificate_enabled: true,
  mentor_name: 'Capt. Maya Singh',
}

describe('learner course repository', () => {
  it('loads an enrolled learner course with persisted sections, lessons and progress', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createLearnerCourseRepository({
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
          },
        ]
      },
    })

    await expect(repository.getLearnerCourse(learnerId, slug)).resolves.toEqual({
      enrollmentId,
      enrollmentStatus: 'active',
      courseId,
      slug,
      title: 'SIRE 2.0 Readiness for Tanker Officers',
      subtitle: 'Practical inspection readiness from a Master Mariner',
      category: 'SIRE 2.0',
      level: 'advanced',
      language: 'English',
      courseFormat: 'recorded',
      certificateEnabled: true,
      mentorName: 'Capt. Maya Singh',
      totalLessons: 2,
      completedLessons: 1,
      progressPercent: 50,
      sections: [
        {
          id: sectionOneId,
          title: 'Inspection foundations',
          position: 0,
          lessons: [
            {
              id: lessonOneId,
              title: 'How SIRE 2.0 changes readiness',
              lessonType: 'article',
              position: 0,
              summary: 'Understand the inspection model before going deeper.',
              articleBody: 'SIRE 2.0 uses a risk-based inspection framework.',
              assetPath: null,
              externalUrl: null,
              durationSeconds: null,
              isDownloadable: false,
              completed: true,
              completedAt: '2026-09-15T08:30:00.000Z',
              lastPositionSeconds: 0,
            },
          ],
        },
        {
          id: sectionTwoId,
          title: 'Operational readiness',
          position: 1,
          lessons: [
            {
              id: lessonTwoId,
              title: 'Bridge readiness walkthrough',
              lessonType: 'video',
              position: 0,
              summary: null,
              articleBody: null,
              assetPath: 'learning/courses/sire-2/bridge-readiness.mp4',
              externalUrl: null,
              durationSeconds: 780,
              isDownloadable: false,
              completed: false,
              completedAt: null,
              lastPositionSeconds: 125,
            },
          ],
        },
      ],
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.values).toEqual([learnerId, slug])
    expect(seen[0]?.text).toContain("course.status = 'published'")
    expect(seen[0]?.text).toContain("mentor.status = 'active'")
    expect(seen[0]?.text).toContain("application.status = 'approved'")
    expect(seen[0]?.text).toContain("enrollment.status in ('active', 'completed')")
    expect(seen[0]?.text).toContain('progress.enrollment_id = enrollment.id')
    expect(seen[0]?.text).toContain('progress.lesson_id = lesson.id')
    expect(seen[0]?.text).toContain('order by section.position asc, lesson.position asc')
  })

  it('fails closed when the learner has no visible enrollment for the published course', async () => {
    const repository = createLearnerCourseRepository({ query: async () => [] })

    await expect(repository.getLearnerCourse(learnerId, slug)).resolves.toBeNull()
  })
})
