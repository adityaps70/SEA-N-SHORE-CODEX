import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { getMediaObject, putMediaObject } from '@/lib/aws/storage'
import { verifyLearningMediaObject } from './media'
import { parseScormPackage } from './scorm-package'

const MAX_SCORM_ZIP_BYTES = 200 * 1024 * 1024

type IdRow = QueryResultRow & { id: string }
type LessonRow = QueryResultRow & { id: string; status: string; lesson_type: string }

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : 'scorm_processing_failed'
  return value.slice(0, 8000)
}

export async function processScormPackageForMentor(input: {
  actorId: string
  courseId: string
  lessonId: string
  sourceZipPath: string
}) {
  const owned = await databaseQuery<LessonRow>(
    `select lesson.id, course.status, lesson.lesson_type
     from public.learning_lessons lesson
     inner join public.learning_course_sections section on section.id = lesson.section_id
     inner join public.learning_courses course on course.id = section.course_id
     inner join public.learning_mentors mentor on mentor.id = course.mentor_id
     where lesson.id = $1 and course.id = $2 and mentor.user_id = $3 and mentor.status = 'active'
     limit 1`,
    [input.lessonId, input.courseId, input.actorId],
  )
  const lesson = owned[0]
  if (!lesson) throw new Error('material_not_found')
  if (lesson.status !== 'draft' && lesson.status !== 'changes_requested') throw new Error('course_edit_forbidden')
  if (lesson.lesson_type !== 'scorm') throw new Error('material_not_scorm')

  await verifyLearningMediaObject({
    userId: input.actorId,
    courseId: input.courseId,
    kind: 'scorm_package',
    storagePath: input.sourceZipPath,
  })

  const packageRows = await databaseQuery<IdRow>(
    `insert into public.learning_scorm_packages (
       lesson_id, source_zip_path, status, processing_error, extracted_prefix, manifest_path, launch_path, scorm_version,
       manifest_metadata, created_at, updated_at
     ) values ($1, $2, 'processing', null, null, null, null, null, '{}'::jsonb, now(), now())
     on conflict (lesson_id) do update
     set source_zip_path = excluded.source_zip_path,
         status = 'processing',
         processing_error = null,
         extracted_prefix = null,
         manifest_path = null,
         launch_path = null,
         scorm_version = null,
         manifest_metadata = '{}'::jsonb,
         updated_at = now()
     returning id`,
    [input.lessonId, input.sourceZipPath],
  )
  const packageRow = packageRows[0]
  if (!packageRow) throw new Error('scorm_package_create_failed')

  try {
    const zip = await getMediaObject({ key: input.sourceZipPath, maxBytes: MAX_SCORM_ZIP_BYTES })
    const parsed = parseScormPackage(zip.body)
    const prefix = `learning/${encodeURIComponent(input.actorId)}/${input.courseId}/scorm_content/${packageRow.id}`

    for (const file of parsed.files) {
      await putMediaObject({
        key: `${prefix}/${file.path}`,
        body: file.body,
        contentType: file.mimeType,
      })
    }

    await databaseQuery(
      `update public.learning_scorm_packages
       set extracted_prefix = $2,
           manifest_path = $3,
           launch_path = $4,
           scorm_version = $5,
           status = 'ready',
           processing_error = null,
           manifest_metadata = $6::jsonb,
           updated_at = now()
       where id = $1`,
      [
        packageRow.id,
        prefix,
        parsed.manifestPath,
        parsed.launchPath,
        parsed.version,
        JSON.stringify(parsed.manifestMetadata),
      ],
    )

    return {
      packageId: packageRow.id,
      version: parsed.version,
      launchPath: parsed.launchPath,
      fileCount: parsed.files.length,
    }
  } catch (error) {
    await databaseQuery(
      `update public.learning_scorm_packages
       set status = 'error', processing_error = $2, updated_at = now()
       where id = $1`,
      [packageRow.id, safeError(error)],
    )
    throw error
  }
}
