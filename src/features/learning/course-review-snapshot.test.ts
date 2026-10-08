import { describe, expect, it } from 'vitest'
import {
  diffCourseSnapshots,
  isCourseReviewSnapshot,
  snapshotSectionsFromRows,
  type CourseReviewSnapshot,
  type CourseSnapshotMaterial,
} from './course-review-snapshot'

function material(id: string, overrides: Partial<CourseSnapshotMaterial> = {}): CourseSnapshotMaterial {
  return {
    id,
    title: `Material ${id}`,
    materialType: 'article',
    summary: null,
    articleBody: 'Body',
    assetPath: null,
    externalUrl: null,
    isPublished: true,
    releaseMode: 'immediate',
    completionRule: 'manual',
    assignmentInstructions: null,
    quiz: null,
    ...overrides,
  }
}

function snapshot(overrides: Partial<CourseReviewSnapshot> = {}): CourseReviewSnapshot {
  return {
    version: 1,
    details: {
      slug: 'sire',
      title: 'SIRE 2.0 Readiness',
      subtitle: null,
      description: 'Description',
      category: 'SIRE 2.0',
      level: 'advanced',
      language: 'English',
      thumbnailPath: null,
      trailerPath: null,
      learningOutcomes: ['One'],
      requirements: [],
      targetAudience: [],
      accessType: 'free',
      priceMinor: 0,
      discountPriceMinor: null,
      currency: 'INR',
      certificateEnabled: true,
      courseFormat: 'recorded',
    },
    sections: [
      { id: 's1', title: 'Module 1', materials: [material('a'), material('b')] },
      { id: 's2', title: 'Module 2', materials: [material('c')] },
    ],
    ...overrides,
  }
}

describe('course review snapshot diff', () => {
  it('reports no changes for an identical resubmission', () => {
    expect(diffCourseSnapshots(snapshot(), snapshot())).toEqual([])
  })

  it('lists changed details, renamed/added/removed sections and changed, added, removed or moved materials', () => {
    const previous = snapshot()
    const current = snapshot({
      details: { ...previous.details, title: 'SIRE 2.0 Readiness — revised', learningOutcomes: ['One', 'Two'] },
      sections: [
        {
          id: 's1',
          title: 'Module 1 · Foundations',
          materials: [
            material('b'),
            material('a', { articleBody: 'Longer body', quiz: null }),
            material('d', { title: 'New checklist' }),
          ],
        },
        { id: 's3', title: 'Module 3', materials: [] },
      ],
    })

    expect(diffCourseSnapshots(previous, current)).toEqual([
      { area: 'details', change: 'changed', label: 'Course details', fields: ['Title', 'Learning outcomes'] },
      { area: 'section', change: 'changed', label: 'Module 1 · Foundations', fields: ['renamed from “Module 1”'] },
      { area: 'material', change: 'moved', label: 'Material b', fields: ['order'] },
      { area: 'material', change: 'changed', label: 'Material a', fields: ['article content', 'order'] },
      { area: 'material', change: 'added', label: 'New checklist', fields: [] },
      { area: 'section', change: 'added', label: 'Module 3', fields: [] },
      { area: 'section', change: 'removed', label: 'Module 2', fields: [] },
      { area: 'material', change: 'removed', label: 'Material c', fields: [] },
    ])
  })

  it('builds quiz content into the snapshot so assessment edits are visible to reviewers', () => {
    const base = {
      section_id: 's1',
      section_title: 'Module 1',
      lesson_id: 'q1',
      lesson_title: 'Knowledge check',
      lesson_type: 'quiz',
      article_body: null,
      asset_path: null,
      external_url: null,
      is_published: true,
      release_mode: 'immediate',
      completion_rule: 'quiz_pass',
      assignment_instructions: null,
      quiz_id: 'quiz-1',
      pass_percentage: '80',
      quiz_instructions: 'Answer all',
    }
    const sections = snapshotSectionsFromRows([
      { ...base, question_id: 'question-1', question_prompt: 'Who leads?', option_id: 'o1', option_label: 'Master', option_is_correct: true },
      { ...base, question_id: 'question-1', question_prompt: 'Who leads?', option_id: 'o2', option_label: 'Cadet', option_is_correct: false },
    ])
    expect(sections[0]?.materials[0]?.quiz).toEqual({
      passPercentage: 80,
      instructions: 'Answer all',
      questions: [{ prompt: 'Who leads?', options: [{ label: 'Master', isCorrect: true }, { label: 'Cadet', isCorrect: false }] }],
    })
  })

  it('recognises only well-formed stored snapshots', () => {
    expect(isCourseReviewSnapshot(snapshot())).toBe(true)
    expect(isCourseReviewSnapshot({})).toBe(false)
    expect(isCourseReviewSnapshot(null)).toBe(false)
  })
})

describe('the review diff covers every course and material setting', () => {
  const fullMaterial = (overrides: Partial<CourseSnapshotMaterial> = {}) => material('m1', {
    articleFormat: 'plain',
    durationSeconds: 60,
    isPreview: false,
    isDownloadable: false,
    releaseAt: null,
    dripDelayDays: null,
    prerequisiteId: null,
    completionThreshold: null,
    maxAttempts: null,
    embedKind: null,
    captionPath: null,
    assignment: null,
    scorm: null,
    ...overrides,
  })

  it('reports each changed setting by name', () => {
    const base = snapshot({ sections: [{ id: 's1', title: 'Section', materials: [fullMaterial()] }] })
    const before = { ...base, details: { ...base.details, navigationMode: 'free' } }
    const after: CourseReviewSnapshot = {
      version: 1,
      details: {
        slug: 'sire-new', title: 'New title', subtitle: 'New subtitle', description: 'New description', category: 'Safety',
        level: 'beginner', language: 'Hindi', thumbnailPath: 'learning/t.png', trailerPath: 'learning/t.mp4',
        learningOutcomes: ['New outcome'], requirements: ['New requirement'], targetAudience: ['New audience'],
        accessType: 'paid', priceMinor: 99900, discountPriceMinor: 49900, currency: 'USD', certificateEnabled: false,
        courseFormat: 'hybrid', navigationMode: 'sequential',
      },
      sections: [{
        id: 's1',
        title: 'Section',
        materials: [fullMaterial({
          title: 'New material title', materialType: 'video', summary: 'New summary', articleBody: 'New body',
          assetPath: 'learning/v.mp4', externalUrl: 'https://example.com', isPublished: false, releaseMode: 'drip',
          completionRule: 'media_percentage', assignmentInstructions: 'New instructions',
          quiz: { passPercentage: 50, instructions: null, questions: [] }, articleFormat: 'html', durationSeconds: 120,
          isPreview: true, isDownloadable: true, releaseAt: '2026-11-01T00:00:00.000Z', dripDelayDays: 3,
          prerequisiteId: 'm0', completionThreshold: 80, maxAttempts: 3, embedKind: 'youtube', captionPath: 'learning/c.vtt',
          assignment: { instructions: 'New instructions', acceptedExtensions: ['.pdf'], maxUploadBytes: 1, maxFiles: 2, maxPoints: 50, passingPercentage: 60 },
          scorm: { sourceZipPath: 'learning/p.zip', launchPath: 'index.html' },
        })],
      }],
    }

    const changes = diffCourseSnapshots(before, after)
    const details = changes.find((change) => change.area === 'details')!
    expect(details.fields).toEqual([
      'Title', 'URL slug', 'Subtitle', 'Description', 'Category', 'Level', 'Language', 'Course format', 'Thumbnail',
      'Trailer', 'Learning outcomes', 'Requirements', 'Target audience', 'Access type', 'Price', 'Discount price',
      'Currency', 'Certificate', 'Navigation (free or in order)',
    ])
    const materialChange = changes.find((change) => change.area === 'material')!
    expect(materialChange.fields).toEqual([
      'title', 'type', 'summary', 'article content', 'uploaded file', 'URL', 'visibility', 'release', 'completion rule',
      'assignment instructions', 'quiz questions', 'article formatting', 'duration', 'free preview', 'download setting',
      'release date', 'drip delay', 'prerequisite', 'completion threshold', 'attempt limit', 'embed provider', 'captions',
      'assignment settings', 'SCORM package',
    ])
  })

  it('does not report settings an older snapshot never recorded', () => {
    const older = snapshot({ sections: [{ id: 's1', title: 'Section', materials: [material('m1')] }] })
    const current = snapshot({ sections: [{ id: 's1', title: 'Section', materials: [fullMaterial({ maxAttempts: 3, isPreview: true })] }] })
    const currentDetails = { ...current, details: { ...current.details, navigationMode: 'sequential' } }

    expect(diffCourseSnapshots(older, currentDetails)).toEqual([])
  })
})
