'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { assessPlatformText, moderationBlockMessage } from '@/features/moderation/automated'
import { firstPlainIssue, plainFieldErrors, type PlainFieldErrors } from '@/lib/validation/plain-messages'
import {
  ANNOUNCEMENT_BODY_MAX_LENGTH,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
  courseAnnouncementRepository,
  type CourseAnnouncement,
} from './course-announcement-repository'

/**
 * Learning round C (C5b): a course manager posts an announcement to everyone enrolled. Generic on purpose: the Studio
 * Announcements panel and the roster's "Message all learners" both call it. `courseId` may be the live course or its
 * draft revision; the announcement always belongs to the live course.
 */

export type PostCourseAnnouncementResult =
  | { ok: true; announcement: CourseAnnouncement }
  | { ok: false; error: string; fieldErrors?: PlainFieldErrors }

const announcementSchema = z.object({
  title: z.string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, 'Add a title.').max(ANNOUNCEMENT_TITLE_MAX_LENGTH, 'The title can be at most 140 characters.')),
  body: z.string()
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().min(1, 'Write your announcement.').max(ANNOUNCEMENT_BODY_MAX_LENGTH, 'The announcement can be at most 5,000 characters.')),
})

const ANNOUNCEMENT_LABELS = { title: 'Title', body: 'Announcement' }

export async function postCourseAnnouncement(courseId: string, input: { title: string; body: string }): Promise<PostCourseAnnouncementResult> {
  if (!z.string().uuid().safeParse(courseId).success) return { ok: false, error: 'This course link is no longer valid. Reload the page and try again.' }
  const parsed = announcementSchema.safeParse({ title: input?.title ?? '', body: input?.body ?? '' })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstPlainIssue(parsed.error, 'Check the announcement and try again.', ANNOUNCEMENT_LABELS),
      fieldErrors: plainFieldErrors(parsed.error, ANNOUNCEMENT_LABELS),
    }
  }
  if (assessPlatformText([parsed.data.title, parsed.data.body]).decision === 'block') {
    return { ok: false, error: moderationBlockMessage() }
  }

  const user = await requireAwsUser()
  try {
    const announcement = await courseAnnouncementRepository.postAnnouncement(user.id, courseId, parsed.data)
    revalidatePath('/learn/studio/courses/[courseId]/edit', 'page')
    revalidatePath('/learn/courses/[slug]/learn', 'page')
    return { ok: true, announcement }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'announcement_forbidden') return { ok: false, error: 'Only the people who run this course can message its learners.' }
    if (code === 'announcement_rate_limited') {
      return { ok: false, error: 'You can send up to 3 announcements per course in 24 hours. Please try again later.' }
    }
    console.error('[course_announcement_failed]', { code: code.slice(0, 80) || 'unknown_error' })
    return { ok: false, error: 'We could not send the announcement. Please try again.' }
  }
}
