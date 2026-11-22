/**
 * Round GP Part E: the country each kind of admin item belongs to, as SQL expressions. Only stored countries are used
 * (an organization's companies.country, a member's profiles.country_of_residence), never estimates: an item whose
 * country is not stored has none, and only platform administrators see or decide it. Each function takes the SQL of
 * the column it starts from (e.g. 'lc.company_id') or a table alias, and returns a text expression (an ISO 3166-1
 * alpha-2 code, or null).
 */

/** An organization's country. */
export function companyCountrySql(companyIdSql: string) {
  return `(select cc.country from public.companies cc where cc.id = ${companyIdSql})`
}

/** A member's country of residence. */
export function memberCountrySql(profileIdSql: string) {
  return `(select pc.country_of_residence from public.profiles pc where pc.id = ${profileIdSql})`
}

/** A course: its organization's country, or else its individual creator's (the trainer's) residence. */
export function courseCountrySql(alias: string) {
  return `(case when ${alias}.company_id is not null then ${companyCountrySql(`${alias}.company_id`)}
    else ${memberCountrySql(`coalesce((select lm.user_id from public.learning_mentors lm where lm.id = ${alias}.mentor_id), ${alias}.created_by_user_id)`)} end)`
}

/** An event: its organizer organization's country, or else its host's residence (the free-text venue country is never used). */
export function eventCountrySql(alias: string) {
  return `(case when ${alias}.company_id is not null then ${companyCountrySql(`${alias}.company_id`)}
    else ${memberCountrySql(`${alias}.host_user_id`)} end)`
}

/** A post: the organization it is published as, or else its author's residence. */
export function postCountrySql(alias: string) {
  return `(case when ${alias}.company_id is not null then ${companyCountrySql(`${alias}.company_id`)}
    else ${memberCountrySql(`${alias}.author_id`)} end)`
}

/** A comment: its author's residence. */
export function commentCountrySql(alias: string) {
  return memberCountrySql(`${alias}.author_id`)
}

/** A job: its organization's country (a job with no organization has none). */
export function jobCountrySql(alias: string) {
  return companyCountrySql(`${alias}.company_id`)
}

/** A community group: its owner organization's country, or else its active owner member's residence. */
export function groupCountrySql(alias: string) {
  return `(case when ${alias}.owner_company_id is not null then ${companyCountrySql(`${alias}.owner_company_id`)}
    else ${memberCountrySql(`(select gm.profile_id from public.community_group_memberships gm
      where gm.group_id = ${alias}.id and gm.role = 'owner' and gm.status = 'active' order by gm.joined_at asc nulls last limit 1)`)} end)`
}

/** A learner's course rating (and its owner reply): the course's country. */
export function courseReviewCountrySql(alias: string) {
  return `(select ${courseCountrySql('rc')} from public.learning_courses rc where rc.id = ${alias}.course_id)`
}

/** The item a report points at (content_reports / moderation target_type + target_id). */
export function reportTargetCountrySql(targetTypeSql: string, targetIdSql: string) {
  return `(case ${targetTypeSql}
    when 'post' then (select ${postCountrySql('tp')} from public.posts tp where tp.id = ${targetIdSql})
    when 'comment' then (select ${commentCountrySql('tc')} from public.post_comments tc where tc.id = ${targetIdSql})
    when 'job' then (select ${jobCountrySql('tj')} from public.jobs tj where tj.id = ${targetIdSql})
    when 'event' then (select ${eventCountrySql('te')} from public.events te where te.id = ${targetIdSql})
    when 'group' then (select ${groupCountrySql('tg')} from public.community_groups tg where tg.id = ${targetIdSql})
    when 'course_review' then (select ${courseReviewCountrySql('tr')} from public.learning_course_reviews tr where tr.id = ${targetIdSql})
    when 'profile' then ${memberCountrySql(targetIdSql)}
    else null end)`
}
