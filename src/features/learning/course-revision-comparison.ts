import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { courseManagerAccessSql } from './course-access'
import type { CourseReviewChange, CourseSnapshotMaterial } from './course-review-snapshot'
import { diffCourseSnapshots } from './course-review-snapshot'
import { mappedRevisionSnapshots } from './course-revision-repository'

/**
 * Learning round E: what a draft revision changes, material by material, with the wording side by side. Read only.
 * Open to the people who manage the course and to platform administrators (the owner reviews content drafts
 * prepared for them, such as the SIRE article conversion, before submitting them for review).
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export type MaterialTextComparison = {
  /** The live material's id (stable: approval updates the live row in place). */
  id: string
  title: string
  sectionTitle: string
  status: 'changed' | 'added' | 'removed'
  /** Which text fields differ: title, summary, article. */
  fields: Array<'title' | 'summary' | 'article'>
  before: { title: string; summary: string | null; articleBody: string | null; articleFormat: string }
  after: { title: string; summary: string | null; articleBody: string | null; articleFormat: string }
}

export type RevisionComparison = {
  revisionCourseId: string
  liveCourseId: string
  liveSlug: string
  title: string
  status: string
  closed: boolean
  changes: CourseReviewChange[]
  materials: MaterialTextComparison[]
}

type RevisionRow = QueryResultRow & {
  id: string
  title: string
  status: string
  revision_of_course_id: string | null
  revision_closed_at: string | Date | null
}

function textOf(material: CourseSnapshotMaterial | undefined) {
  return {
    title: material?.title ?? '',
    summary: material?.summary ?? null,
    articleBody: material?.articleBody ?? null,
    articleFormat: material?.articleFormat ?? 'plain',
  }
}

export function compareMaterialText(
  live: Array<{ title: string; materials: CourseSnapshotMaterial[] }>,
  revision: Array<{ title: string; materials: CourseSnapshotMaterial[] }>,
): MaterialTextComparison[] {
  const liveById = new Map(live.flatMap((section) => section.materials.map((material) => [material.id, { material, sectionTitle: section.title }] as const)))
  const seen = new Set<string>()
  const out: MaterialTextComparison[] = []
  for (const section of revision) {
    for (const material of section.materials) {
      seen.add(material.id)
      const before = liveById.get(material.id)
      const after = textOf(material)
      if (!before) {
        out.push({ id: material.id, title: material.title, sectionTitle: section.title, status: 'added', fields: ['title', 'summary', 'article'].filter((field) => field === 'title' || (field === 'summary' ? after.summary : after.articleBody)) as MaterialTextComparison['fields'], before: textOf(undefined), after })
        continue
      }
      const previous = textOf(before.material)
      const fields: MaterialTextComparison['fields'] = []
      if (previous.title !== after.title) fields.push('title')
      if ((previous.summary ?? '') !== (after.summary ?? '')) fields.push('summary')
      if ((previous.articleBody ?? '') !== (after.articleBody ?? '') || (previous.articleBody && previous.articleFormat !== after.articleFormat)) fields.push('article')
      if (fields.length) out.push({ id: material.id, title: material.title, sectionTitle: section.title, status: 'changed', fields, before: previous, after })
    }
  }
  for (const [id, entry] of liveById) {
    if (!seen.has(id)) out.push({ id, title: entry.material.title, sectionTitle: entry.sectionTitle, status: 'removed', fields: [], before: textOf(entry.material), after: textOf(undefined) })
  }
  return out
}

export function createCourseRevisionComparisonRepository(input: { query?: Query } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  /** Null when the course is not a draft revision the actor may see. */
  async function load(actorId: string, revisionCourseId: string, options: { platformAdmin: boolean }): Promise<RevisionComparison | null> {
    const rows = await query(
      `select course.id, course.title, course.status, course.revision_of_course_id, course.revision_closed_at
       from public.learning_courses course
       where course.id = $1
         and course.revision_of_course_id is not null
         and ($3::boolean or ${courseManagerAccessSql('course', '$2')})`,
      [revisionCourseId, actorId, options.platformAdmin],
    ) as RevisionRow[]
    const revision = rows[0]
    if (!revision?.revision_of_course_id) return null
    const snapshots = await mappedRevisionSnapshots(query, revision.id, revision.revision_of_course_id)
    if (!snapshots) return null
    return {
      revisionCourseId: revision.id,
      liveCourseId: revision.revision_of_course_id,
      liveSlug: snapshots.live.details.slug,
      title: revision.title,
      status: revision.status,
      closed: Boolean(revision.revision_closed_at),
      changes: diffCourseSnapshots(snapshots.live, snapshots.mapped),
      materials: compareMaterialText(snapshots.live.sections, snapshots.mapped.sections),
    }
  }

  return { load }
}

export const courseRevisionComparisonRepository = createCourseRevisionComparisonRepository()
