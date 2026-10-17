import { LEARNING_NOTIFICATION_KINDS, type LearningNotificationDetails, type LearningNotificationKind } from './learning-notifications'
import { DEFAULT_TIME_ZONE, formatZonedRange, formatZonedTime } from './sessions/session-time'
import { pluralize } from '@/lib/format'

/**
 * What a learning notification says and where it leads, shared by the in-app list and the email.
 * Pure: the same details always give the same words.
 */

export type LearningNotificationCopy = {
  /** One sentence for the in-app list and the email body. */
  message: string
  /** Site path the notification opens. */
  path: string
  /** Email subject. */
  subject: string
  /** Email button label. */
  action: string
  /** Optional longer text shown in the email under the message (an announcement's text). */
  detail?: string
}

function quoted(title: string | null | undefined) {
  return title ? `“${title}”` : 'A material'
}

function playerPath(details: LearningNotificationDetails) {
  const base = `/learn/courses/${details.courseSlug}/learn`
  return details.lessonId ? `${base}?lesson=${details.lessonId}` : base
}

function studioPath(details: LearningNotificationDetails) {
  return details.studioCourseId ? `/learn/studio/courses/${details.studioCourseId}/edit` : '/learn/studio'
}

export function learningNotificationCopy(kind: LearningNotificationKind, details: LearningNotificationDetails): LearningNotificationCopy {
  const course = details.courseTitle
  switch (kind) {
    case 'enrolled':
      return {
        message: `You’re enrolled in ${course}. Start whenever you’re ready.`,
        path: playerPath({ ...details, lessonId: null }),
        subject: `You’re enrolled in ${course}`,
        action: 'Start learning',
      }
    case 'lessons_released': {
      const count = details.count ?? 1
      return count > 1
        ? {
          message: `${count} new materials are now available in ${course}.`,
          path: playerPath(details),
          subject: `${count} new materials in ${course}`,
          action: 'Continue learning',
        }
        : {
          message: `${quoted(details.lessonTitle)} is now available in ${course}.`,
          path: playerPath(details),
          subject: `New in ${course}: ${details.lessonTitle ?? 'a new material'}`,
          action: 'Open the material',
        }
    }
    case 'assignment_graded': {
      const score = typeof details.percentage === 'number' ? `${details.percentage}%` : 'graded'
      const outcome = details.passed === true ? 'passed' : details.passed === false ? 'not passed yet; you can submit again if attempts remain' : null
      return {
        message: `Your assignment ${quoted(details.lessonTitle)} in ${course} was graded: ${score}${outcome ? `, ${outcome}` : ''}.`,
        path: playerPath(details),
        subject: `Your assignment in ${course} was graded`,
        action: 'See your grade and feedback',
      }
    }
    case 'certificate_issued':
      return {
        message: `You earned your certificate for ${course}.`,
        path: details.verificationCode ? `/certificates/${details.verificationCode}` : '/learn/my-learning',
        subject: `Your certificate for ${course}`,
        action: 'View your certificate',
      }
    case 'course_approved':
      return details.revision
        ? {
          message: `Sea N Shore approved your changes to ${course}. Learners see them now.`,
          path: studioPath(details),
          subject: `Your changes to ${course} are live`,
          action: 'Open in Studio',
        }
        : {
          message: `Sea N Shore approved ${course}. It’s live in the course catalogue.`,
          path: studioPath(details),
          subject: `${course} is approved and live`,
          action: 'Open in Studio',
        }
    case 'course_changes_requested':
      return {
        message: details.revision
          ? `Sea N Shore asked for changes to your edits of ${course}. The published course is unchanged; see the reviewer’s note.`
          : `Sea N Shore asked for changes to ${course}. See the reviewer’s note.`,
        path: studioPath(details),
        subject: `Changes requested for ${course}`,
        action: 'See the reviewer’s note',
      }
    case 'quiz_graded': {
      const score = typeof details.percentage === 'number' ? `${details.percentage}%` : 'graded'
      const outcome = details.passed === true ? 'passed' : details.passed === false ? 'not passed yet; you can try again if attempts remain' : null
      return {
        message: `Your trainer graded your answers to ${quoted(details.lessonTitle)} in ${course}: ${score}${outcome ? `, ${outcome}` : ''}.`,
        path: playerPath(details),
        subject: `Your quiz in ${course} was graded`,
        action: 'See your result',
      }
    }
    case 'certificate_expiring': {
      const days = details.daysLeft ?? 30
      const when = details.expiresAt
        ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(details.expiresAt))
        : `in ${pluralize(days, 'day')}`
      return {
        message: `Your certificate for ${course} expires ${details.expiresAt ? `on ${when}` : when}. Renew it by taking the course again.`,
        path: details.verificationCode ? `/certificates/${details.verificationCode}` : '/learn/my-learning',
        subject: `Your ${course} certificate expires in ${pluralize(days, 'day')}`,
        action: 'View your certificate',
      }
    }
    case 'announcement': {
      const title = details.announcementTitle?.trim() || 'a new announcement'
      return {
        message: `New announcement in ${course}: “${title}”.`,
        path: `/learn/courses/${details.courseSlug}/learn?tab=announcements`,
        subject: `${course}: ${title}`,
        action: 'Read the announcement',
        ...(details.announcementExcerpt ? { detail: details.announcementExcerpt } : {}),
      }
    }
    case 'session_reminder': {
      const title = details.sessionTitle?.trim() || 'Your live session'
      const zone = details.timeZone || DEFAULT_TIME_ZONE
      const when = details.startsAt ? formatZonedRange(details.startsAt, details.durationMinutes ?? 60, zone, { withYear: true }) : 'soon'
      const utc = details.startsAt && zone !== 'UTC' ? ` (${formatZonedTime(details.startsAt, 'UTC')})` : ''
      const soon = details.stage === '1h' ? 'starts in about an hour' : 'is coming up'
      return {
        message: `${quoted(title)} in ${course} ${soon}: ${when}${utc}.`,
        path: `/learn/courses/${details.courseSlug}/learn?tab=sessions`,
        subject: details.stage === '1h' ? `Starting soon: ${title}` : `Coming up: ${title}`,
        action: 'Open your sessions',
        detail: 'Join from your Sessions tab. You can add every session to your calendar there.',
      }
    }
    case 'submissions_to_grade': {
      const count = details.count ?? 1
      const quizAnswers = details.quizAnswerCount ?? 0
      const assignments = details.assignmentCount ?? count - quizAnswers
      const parts = [
        assignments > 0 ? `${assignments} assignment ${assignments === 1 ? 'submission' : 'submissions'}` : null,
        quizAnswers > 0 ? `${quizAnswers} quiz ${quizAnswers === 1 ? 'attempt' : 'attempts'} with written answers` : null,
      ].filter(Boolean)
      return {
        message: `${parts.length ? parts.join(' and ') : `${count} assignment submission`} ${count === 1 ? 'is' : 'are'} waiting to be graded in ${course}.`,
        path: '/learn/studio/assignments',
        subject: `${count} ${count === 1 ? 'submission' : 'submissions'} to grade in ${course}`,
        action: 'Grade submissions',
      }
    }
  }
}

/** The kind of a learning notification type (`learning_enrolled` → `enrolled`), or null for other types. */
export function learningKindOf(type: string): LearningNotificationKind | null {
  if (!type.startsWith('learning_')) return null
  const kind = type.slice('learning_'.length)
  return (LEARNING_NOTIFICATION_KINDS as readonly string[]).includes(kind) ? kind as LearningNotificationKind : null
}
