import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createCommunityRepository } from '@/features/community/repository'
import { courseManagerAccessSql } from './course-access'
import { learnerCourseAccessSql } from './course-publication'

/**
 * Course discussion through communities (learning round C, C7). A course's managers link the live course to one
 * Sea N Shore community they run (active owner or admin, not archived). Enrolled learners then see "Ask the trainer /
 * Discuss" in the player; opening it re-checks the enrolment and, when the community is private (or needs approval
 * to join), makes the learner an active member. Membership granted through a course stays when the course access
 * ends (owner decision, 10 October). Someone a community admin removed is never added back by a course.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export type LinkableCommunity = {
  id: string
  name: string
  slug: string
  visibility: 'public' | 'private'
}

export type CourseCommunityLink = {
  liveCourseId: string
  current: (LinkableCommunity & { archived: boolean }) | null
  options: LinkableCommunity[]
}

export type CourseDiscussion = {
  groupId: string
  name: string
  visibility: 'public' | 'private'
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

function mapCommunity(row: QueryResultRow): LinkableCommunity {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    visibility: row.visibility === 'private' ? 'private' : 'public',
  }
}

/** `$1` = course or draft revision id, `$2` = the actor. The live course, when the actor manages it. */
const MANAGED_LIVE_COURSE_SQL = `select course.id, course.community_group_id
  from public.learning_courses course
  where course.id = (select coalesce(given.revision_of_course_id, given.id) from public.learning_courses given where given.id = $1)
    and course.revision_of_course_id is null
    and ${courseManagerAccessSql('course', '$2')}`

/** `$1` = the actor. Live communities where the actor is an active owner or admin. */
const RUN_BY_ACTOR_SQL = `select g.id, g.name, g.slug, g.visibility
  from public.community_groups g
  inner join public.community_group_memberships m on m.group_id = g.id
  where m.profile_id = $1
    and m.status = 'active'
    and m.role in ('owner', 'admin')
    and g.archived_at is null`

export function createCourseCommunityRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  /** Studio: the course's linked community and the communities the actor may link it to. Null when not a manager. */
  async function getLinkForManager(actorId: string, courseId: string): Promise<CourseCommunityLink | null> {
    const courses = await queryRows(MANAGED_LIVE_COURSE_SQL, [courseId, actorId])
    const course = courses[0]
    if (!course) return null
    const [options, current] = await Promise.all([
      queryRows(`${RUN_BY_ACTOR_SQL} order by lower(g.name), g.id`, [actorId]),
      course.community_group_id
        ? queryRows(`select id, name, slug, visibility, archived_at from public.community_groups where id = $1`, [course.community_group_id])
        : Promise.resolve([] as QueryResultRow[]),
    ])
    return {
      liveCourseId: String(course.id),
      current: current[0] ? { ...mapCommunity(current[0]), archived: Boolean(current[0].archived_at) } : null,
      options: options.map(mapCommunity),
    }
  }

  /**
   * Links the live course to a community (or unlinks it with null). Errors: `course_not_found` (not a manager),
   * `community_not_allowed` (the actor does not run that community, or it is archived or missing).
   */
  async function setLink(actorId: string, courseId: string, groupId: string | null) {
    return transaction(async (query) => {
      const courses = await query(`${MANAGED_LIVE_COURSE_SQL} for update of course`, [courseId, actorId])
      const course = courses[0]
      if (!course) throw new Error('course_not_found')
      if (groupId) {
        const allowed = await query(`${RUN_BY_ACTOR_SQL} and g.id = $2 for share of g, m`, [actorId, groupId])
        if (!allowed[0]) throw new Error('community_not_allowed')
      }
      const previous = course.community_group_id ? String(course.community_group_id) : null
      if (previous === groupId) return { liveCourseId: String(course.id), groupId }
      await query(
        `update public.learning_courses set community_group_id = $2, updated_at = now() where id = $1`,
        [course.id, groupId],
      )
      await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, 'learning_course', $3, $4::jsonb)`,
        [actorId, groupId ? 'learning.course_community_linked' : 'learning.course_community_unlinked', course.id, JSON.stringify({ groupId, previousGroupId: previous })],
      )
      return { liveCourseId: String(course.id), groupId }
    })
  }

  /** The player: the live course's community, when one is linked and still live. */
  async function getDiscussion(courseId: string): Promise<CourseDiscussion | null> {
    const rows = await queryRows(
      `select g.id, g.name, g.visibility
       from public.learning_courses course
       inner join public.community_groups g on g.id = course.community_group_id
       where course.id = $1 and course.revision_of_course_id is null and g.archived_at is null`,
      [courseId],
    )
    const row = rows[0]
    return row ? { groupId: String(row.id), name: String(row.name), visibility: row.visibility === 'private' ? 'private' : 'public' } : null
  }

  /**
   * "Ask the trainer / Discuss": checks that the learner is enrolled (active or completed, never revoked) and the
   * linked community is live, then grants access to a private community (or one that needs approval to join) by
   * making the learner an active member. Existing owners and admins keep their role; a member a community admin
   * removed is not added back (`discussion_removed`). Returns the community's slug to open.
   */
  async function openDiscussion(learnerId: string, courseId: string): Promise<{ slug: string; granted: boolean }> {
    return transaction(async (query) => {
      const enrolled = await query(
        `select course.community_group_id
         from public.learning_enrollments enrollment
         inner join public.learning_courses course on course.id = enrollment.course_id
         left join public.learning_mentors mentor on mentor.id = course.mentor_id
         left join public.learning_mentor_applications application
           on application.id = mentor.application_id and application.user_id = mentor.user_id
         left join public.companies company on company.id = course.company_id
         where enrollment.learner_id = $1
           and enrollment.course_id = $2
           and enrollment.status in ('active', 'completed')
           and course.revision_of_course_id is null
           and ${learnerCourseAccessSql()}
         limit 1`,
        [learnerId, courseId],
      )
      if (!enrolled[0]) throw new Error('discussion_not_enrolled')
      const groupId = enrolled[0].community_group_id ? String(enrolled[0].community_group_id) : null
      if (!groupId) throw new Error('discussion_unavailable')

      const groups = await query(
        `select id, slug, visibility, join_policy from public.community_groups where id = $1 and archived_at is null for share`,
        [groupId],
      )
      const group = groups[0]
      if (!group) throw new Error('discussion_unavailable')

      const memberships = await query(
        `select role, status from public.community_group_memberships where group_id = $1 and profile_id = $2 for update`,
        [groupId, learnerId],
      )
      const membership = memberships[0]
      if (membership?.status === 'removed') throw new Error('discussion_removed')
      if (membership?.status === 'active') return { slug: String(group.slug), granted: false }

      const needsGrant = group.visibility === 'private' || group.join_policy === 'approval'
      if (!needsGrant) return { slug: String(group.slug), granted: false }

      // The community's own writer: inserts an active 'member' row, or activates a pending request keeping its role.
      await createCommunityRepository({ query }).activateMembership(groupId, learnerId)
      await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'community.course_access_granted', 'group', $2, $3::jsonb)`,
        [learnerId, groupId, JSON.stringify({ courseId })],
      )
      return { slug: String(group.slug), granted: true }
    })
  }

  return { getLinkForManager, setLink, getDiscussion, openDiscussion }
}

export type CourseCommunityRepository = ReturnType<typeof createCourseCommunityRepository>
export const courseCommunityRepository = createCourseCommunityRepository()
