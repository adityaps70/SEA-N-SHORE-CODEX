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
