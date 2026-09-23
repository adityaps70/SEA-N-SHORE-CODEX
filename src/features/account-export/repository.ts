import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'

type ExportPayload = Record<string, unknown>
type ExportRow = QueryResultRow & {
  export_data?: unknown
}
type Query = (text: string, values?: readonly unknown[]) => Promise<ExportRow[]>

const ACCOUNT_EXPORT_SQL = `
with owned_posts as (
  select post.id
  from public.posts post
  where post.author_id = $1
),
owned_courses as (
  select course.id
  from public.learning_courses course
  join public.learning_mentors mentor on mentor.id = course.mentor_id
  where mentor.user_id = $1
),
owned_sections as (
  select section.id
  from public.learning_course_sections section
  where section.course_id in (select id from owned_courses)
),
owned_lessons as (
  select lesson.id
  from public.learning_lessons lesson
  where lesson.section_id in (select id from owned_sections)
),
own_enrollments as (
  select enrollment.id
  from public.learning_enrollments enrollment
  where enrollment.learner_id = $1
),
own_quiz_attempts as (
  select attempt.id
  from public.learning_quiz_attempts attempt
  where attempt.learner_id = $1
)
select jsonb_build_object(
  'profile', (
    select to_jsonb(profile)
    from public.profiles profile
    where profile.id = $1
  ),
  'maritimeProfile', (
    select to_jsonb(profile)
    from public.maritime_profiles profile
    where profile.user_id = $1
  ),
  'profileSkills', coalesce((
    select jsonb_agg(to_jsonb(skill))
    from public.profile_skills skill
    where skill.user_id = $1
  ), '[]'::jsonb),
  'profileExperiences', coalesce((
    select jsonb_agg(to_jsonb(experience))
    from public.profile_experiences experience
    where experience.profile_id = $1
  ), '[]'::jsonb),
  'profileCredentials', coalesce((
    select jsonb_agg(to_jsonb(credential))
    from public.profile_credentials credential
    where credential.profile_id = $1
  ), '[]'::jsonb),
  'profileVisas', coalesce((
    select jsonb_agg(to_jsonb(visa))
    from public.profile_visas visa
    where visa.profile_id = $1
  ), '[]'::jsonb),

  'posts', coalesce((
    select jsonb_agg(to_jsonb(post))
    from public.posts post
    where post.author_id = $1
  ), '[]'::jsonb),
  'postMedia', coalesce((
    select jsonb_agg(to_jsonb(media))
    from public.post_media media
    where media.post_id in (select id from owned_posts)
  ), '[]'::jsonb),
  'postPolls', coalesce((
    select jsonb_agg(to_jsonb(poll))
    from public.post_polls poll
    where poll.post_id in (select id from owned_posts)
  ), '[]'::jsonb),
  'postPollOptions', coalesce((
    select jsonb_agg(to_jsonb(option_row))
    from public.post_poll_options option_row
    where option_row.post_id in (select id from owned_posts)
  ), '[]'::jsonb),
  'comments', coalesce((
    select jsonb_agg(to_jsonb(comment_row))
    from public.post_comments comment_row
    where comment_row.author_id = $1
  ), '[]'::jsonb),
  'postReactions', coalesce((
    select jsonb_agg(to_jsonb(reaction))
    from public.post_reactions reaction
    where reaction.user_id = $1
  ), '[]'::jsonb),
  'commentReactions', coalesce((
    select jsonb_agg(to_jsonb(reaction))
    from public.comment_reactions reaction
    where reaction.user_id = $1
  ), '[]'::jsonb),
  'savedPosts', coalesce((
    select jsonb_agg(to_jsonb(saved))
    from public.saved_posts saved
    where saved.user_id = $1
  ), '[]'::jsonb),
  'pollVotes', coalesce((
    select jsonb_agg(to_jsonb(vote))
    from public.post_poll_votes vote
    where vote.user_id = $1
  ), '[]'::jsonb),
  'mentionsCreated', coalesce((
    select jsonb_agg(to_jsonb(mention))
    from public.content_mentions mention
    where mention.actor_id = $1
  ), '[]'::jsonb),

  'connections', coalesce((
    select jsonb_agg(
      to_jsonb(connection) || jsonb_build_object(
        'otherProfile',
        jsonb_build_object(
          'id', other_profile.id,
          'slug', other_profile.slug,
          'fullName', other_profile.full_name,
          'headline', other_profile.headline
        )
      )
    )
    from public.connections connection
    join public.profiles other_profile
      on other_profile.id = case
        when connection.user_low_id = $1 then connection.user_high_id
        else connection.user_low_id
      end
    where connection.user_low_id = $1 or connection.user_high_id = $1
  ), '[]'::jsonb),
  'following', coalesce((
    select jsonb_agg(
      to_jsonb(follow_row) || jsonb_build_object(
        'profile',
        jsonb_build_object(
          'id', followed_profile.id,
          'slug', followed_profile.slug,
          'fullName', followed_profile.full_name,
          'headline', followed_profile.headline
        )
      )
    )
    from public.follows follow_row
    join public.profiles followed_profile on followed_profile.id = follow_row.following_id
    where follow_row.follower_id = $1
  ), '[]'::jsonb),
  'followers', coalesce((
    select jsonb_agg(
      to_jsonb(follow_row) || jsonb_build_object(
        'profile',
        jsonb_build_object(
          'id', follower_profile.id,
          'slug', follower_profile.slug,
          'fullName', follower_profile.full_name,
          'headline', follower_profile.headline
        )
      )
    )
    from public.follows follow_row
    join public.profiles follower_profile on follower_profile.id = follow_row.follower_id
    where follow_row.following_id = $1
  ), '[]'::jsonb),
  'blockedUsers', coalesce((
    select jsonb_agg(
      to_jsonb(block_row) || jsonb_build_object(
        'profile',
        jsonb_build_object(
          'id', blocked_profile.id,
          'slug', blocked_profile.slug,
          'fullName', blocked_profile.full_name
        )
      )
    )
    from public.user_blocks block_row
    join public.profiles blocked_profile on blocked_profile.id = block_row.blocked_id
    where block_row.blocker_id = $1
  ), '[]'::jsonb),

  'conversationPreferences', coalesce((
    select jsonb_agg(to_jsonb(participant))
    from public.conversation_participants participant
    where participant.profile_id = $1
  ), '[]'::jsonb),
  'conversations', coalesce((
    select jsonb_agg(to_jsonb(conversation))
    from public.conversations conversation
    where conversation.direct_user_low_id = $1
       or conversation.direct_user_high_id = $1
  ), '[]'::jsonb),
  'sentMessages', coalesce((
    select jsonb_agg(to_jsonb(message))
    from public.messages message
    where message.sender_profile_id = $1
  ), '[]'::jsonb),
  'messageReactions', coalesce((
    select jsonb_agg(to_jsonb(reaction))
    from public.message_reactions reaction
    where reaction.profile_id = $1
  ), '[]'::jsonb),

  'companiesCreated', coalesce((
    select jsonb_agg(to_jsonb(company))
    from public.companies company
    where company.created_by = $1
  ), '[]'::jsonb),
  'companyMemberships', coalesce((
    select jsonb_agg(to_jsonb(membership))
    from public.company_members membership
    where membership.user_id = $1
  ), '[]'::jsonb),
  'companyAccessRequests', coalesce((
    select jsonb_agg(
      to_jsonb(request_row) - 'reviewed_by' - 'reviewer_note'
    )
    from public.company_access_requests request_row
    where request_row.user_id = $1
  ), '[]'::jsonb),
  'organizationApplications', coalesce((
    select jsonb_agg(
      to_jsonb(application) - 'reviewed_by' - 'admin_review_note'
    )
    from public.organization_applications application
    where application.submitted_by = $1
  ), '[]'::jsonb),

  'jobsCreated', coalesce((
    select jsonb_agg(to_jsonb(job))
    from public.jobs job
    where job.created_by_user_id = $1
  ), '[]'::jsonb),
  'jobApplications', coalesce((
    select jsonb_agg(to_jsonb(application))
    from public.job_applications application
    where application.applicant_id = $1
  ), '[]'::jsonb),
  'jobSaves', coalesce((
    select jsonb_agg(to_jsonb(saved))
    from public.job_saves saved
    where saved.user_id = $1
  ), '[]'::jsonb),
  'jobAlerts', coalesce((
    select jsonb_agg(to_jsonb(alert))
    from public.job_alerts alert
    where alert.user_id = $1
  ), '[]'::jsonb),
  'jobReports', coalesce((
    select jsonb_agg(to_jsonb(report) - 'reviewed_by')
    from public.job_reports report
    where report.reporter_id = $1
  ), '[]'::jsonb),
  'recruiterNotesAuthored', coalesce((
    select jsonb_agg(to_jsonb(note))
    from public.job_recruiter_notes note
    where note.recruiter_id = $1
  ), '[]'::jsonb),
  'contentReports', coalesce((
    select jsonb_agg(
      to_jsonb(report) - 'reviewed_by' - 'reviewer_note'
    )
    from public.content_reports report
    where report.reporter_id = $1
  ), '[]'::jsonb),

  'hostedEvents', coalesce((
    select jsonb_agg(to_jsonb(event_row))
    from public.events event_row
    where event_row.host_user_id = $1
  ), '[]'::jsonb),
  'eventAttendances', coalesce((
    select jsonb_agg(to_jsonb(attendee))
    from public.event_attendees attendee
    where attendee.user_id = $1
  ), '[]'::jsonb),

  'learningMentorApplication', (
    select to_jsonb(application) - 'reviewed_by' - 'admin_review_note'
    from public.learning_mentor_applications application
    where application.user_id = $1
  ),
  'learningMentorProfile', (
    select to_jsonb(mentor) - 'approved_by'
    from public.learning_mentors mentor
    where mentor.user_id = $1
  ),
  'learningCoursesAuthored', coalesce((
    select jsonb_agg(
      to_jsonb(course) - 'reviewed_by' - 'admin_review_note'
    )
    from public.learning_courses course
    where course.id in (select id from owned_courses)
  ), '[]'::jsonb),
  'learningCourseSectionsAuthored', coalesce((
    select jsonb_agg(to_jsonb(section))
    from public.learning_course_sections section
    where section.id in (select id from owned_sections)
  ), '[]'::jsonb),
  'learningLessonsAuthored', coalesce((
    select jsonb_agg(to_jsonb(lesson))
    from public.learning_lessons lesson
    where lesson.id in (select id from owned_lessons)
  ), '[]'::jsonb),
  'learningAssignmentsAuthored', coalesce((
    select jsonb_agg(to_jsonb(assignment))
    from public.learning_assignments assignment
    where assignment.lesson_id in (select id from owned_lessons)
  ), '[]'::jsonb),
  'learningQuizzesAuthored', coalesce((
    select jsonb_agg(to_jsonb(quiz))
    from public.learning_quizzes quiz
    where quiz.lesson_id in (select id from owned_lessons)
  ), '[]'::jsonb),
  'learningQuizQuestionsAuthored', coalesce((
    select jsonb_agg(to_jsonb(question))
    from public.learning_quiz_questions question
    where question.quiz_id in (
      select quiz.id
      from public.learning_quizzes quiz
      where quiz.lesson_id in (select id from owned_lessons)
    )
  ), '[]'::jsonb),
  'learningQuizOptionsAuthored', coalesce((
    select jsonb_agg(to_jsonb(option_row))
    from public.learning_quiz_options option_row
    where option_row.question_id in (
      select question.id
      from public.learning_quiz_questions question
      where question.quiz_id in (
        select quiz.id
        from public.learning_quizzes quiz
        where quiz.lesson_id in (select id from owned_lessons)
      )
    )
  ), '[]'::jsonb),

  'learningEnrollments', coalesce((
    select jsonb_agg(to_jsonb(enrollment))
    from public.learning_enrollments enrollment
    where enrollment.learner_id = $1
  ), '[]'::jsonb),
  'learningProgress', coalesce((
    select jsonb_agg(to_jsonb(progress))
    from public.learning_progress progress
    where progress.enrollment_id in (select id from own_enrollments)
  ), '[]'::jsonb),
  'learningQuizAttempts', coalesce((
    select jsonb_agg(to_jsonb(attempt))
    from public.learning_quiz_attempts attempt
    where attempt.learner_id = $1
  ), '[]'::jsonb),
  'learningQuizAttemptAnswers', coalesce((
    select jsonb_agg(to_jsonb(answer))
    from public.learning_quiz_attempt_answers answer
    where answer.attempt_id in (select id from own_quiz_attempts)
  ), '[]'::jsonb),
  'learningAssignmentAttempts', coalesce((
    select jsonb_agg(to_jsonb(attempt))
    from public.learning_assignment_attempts attempt
    where attempt.learner_id = $1
  ), '[]'::jsonb),
  'learningScormAttempts', coalesce((
    select jsonb_agg(to_jsonb(attempt))
    from public.learning_scorm_attempts attempt
    where attempt.learner_id = $1
  ), '[]'::jsonb),
  'learningCertificates', coalesce((
    select jsonb_agg(to_jsonb(certificate))
    from public.learning_certificates certificate
    where certificate.learner_id = $1
  ), '[]'::jsonb)
) as export_data
`

function normalizeExportPayload(value: unknown): ExportPayload {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as ExportPayload
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ExportPayload
      }
    } catch {
      return {}
    }
  }

  return {}
}

const runtimeQuery: Query = (text, values) => databaseQuery<ExportRow>(text, values)

export function createAccountExportRepository(input: { query?: Query } = {}) {
  const query = input.query ?? runtimeQuery

  return {
    async exportAccountData(profileId: string): Promise<ExportPayload> {
      const rows = await query(ACCOUNT_EXPORT_SQL, [profileId])
      return normalizeExportPayload(rows[0]?.export_data)
    },
  }
}

export const accountExportRepository = createAccountExportRepository()
