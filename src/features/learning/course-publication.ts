import { planVisibleSql } from '@/features/billing/plan-visibility'

export function publishedCourseVisibilitySql(
  courseAlias = 'course',
  mentorAlias = 'mentor',
  applicationAlias = 'application',
  companyAlias = 'company',
) {
  return `${courseAlias}.status = 'published'
    and (
      (
        ${courseAlias}.company_id is null
        and ${mentorAlias}.status = 'active'
        and ${applicationAlias}.status = 'approved'
      )
      or (
        ${courseAlias}.company_id is not null
        and ${companyAlias}.is_verified = true
      )
    )`
}

export function coursePublisherNameSql(
  courseAlias = 'course',
  applicationAlias = 'application',
  companyAlias = 'company',
) {
  return `case
    when ${courseAlias}.company_id is null then ${applicationAlias}.applicant_name
    else ${companyAlias}.name
  end`
}

/**
 * Existing learners (active or completed enrollment) keep their course when it is
 * removed from Sea N Shore because its owner deleted their account (removed_at), and
 * when the owner's plan ends (plan visibility is not checked here).
 */
export function learnerCourseAccessSql(
  courseAlias = 'course',
  mentorAlias = 'mentor',
  applicationAlias = 'application',
  companyAlias = 'company',
) {
  return `((${publishedCourseVisibilitySql(courseAlias, mentorAlias, applicationAlias, companyAlias)})
    or ${courseAlias}.removed_at is not null)`
}

/**
 * Listed, enrollable and for sale: published by an active publisher, not removed, and
 * the owner's Creator Pro / Organization Pro has not ended (billing/plan-visibility).
 */
export function courseOpenToNewLearnersSql(
  courseAlias = 'course',
  mentorAlias = 'mentor',
  applicationAlias = 'application',
  companyAlias = 'company',
) {
  return `(${publishedCourseVisibilitySql(courseAlias, mentorAlias, applicationAlias, companyAlias)})
    and ${courseAlias}.removed_at is null
    and ${planVisibleSql('course', courseAlias)}`
}
