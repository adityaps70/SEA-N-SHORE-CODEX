import { query as databaseQuery } from '@/lib/db/client'
import { CANDIDATE_PROFILE_COLUMNS, mapCandidateProfileRow, type JobCandidateRow } from '@/features/jobs/repository'
import type { JobListing, JobMatchResult } from '@/features/jobs/types'
import type { RelationshipState } from '@/features/network/types'
import { jobAcceptedRoleKeys } from '@/features/jobs/matching'
import { ROLES } from '@/features/roles/taxonomy'
import { RANK_BAND_STEPS, rankDistance } from '@/features/taxonomy/maritime-taxonomy'
import { scoreJobForMember } from './job-match'
import { JOB_WEIGHTS } from './job-weights'

/**
 * Round G (G3): Suggested candidates for a recruiter's live job. Only members who turned on
 * "Let recruiters find me as open to work" (Settings › Privacy) are ever listed; never the
 * recruiter, never anyone blocked either way, never someone who already applied. Scored with the
 * same matching v2 the member sees; only eligible members with a score are shown. Contact is
 * through existing messaging (connections only) or a connection request; no contact details.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export type SuggestedCandidate = {
  id: string
  slug: string | null
  fullName: string
  avatarPath: string | null
  headline: string | null
  location: string | null
  relationship: RelationshipState
  match: JobMatchResult
}

const POOL = 300

/** The job without its visa requirements (see list()). */
function publicJobView(job: JobListing): JobListing {
  return { ...job, visaRequirements: [], visaList: [] }
}

function relationshipFor(row: Record<string, unknown>, recruiterId: string): RelationshipState {
  const id = row.connection_id ? String(row.connection_id) : null
  if (!id) return { following: false, connection: { kind: 'none', connectionId: null } }
  if (row.connection_status === 'accepted') return { following: false, connection: { kind: 'connected', connectionId: id } }
  return {
    following: false,
    connection: row.connection_requested_by === recruiterId ? { kind: 'outgoing_pending', connectionId: id } : { kind: 'incoming_pending', connectionId: id },
  }
}

export function createJobCandidateSuggestions(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values) as Promise<Array<Record<string, unknown>>>)

  async function list(recruiterId: string, job: JobListing, limit: number = JOB_WEIGHTS.recruiters.suggestedCandidates): Promise<SuggestedCandidate[]> {
    const accepted = jobAcceptedRoleKeys(job)
    const bandKeys = ROLES.filter((role) => !role.other && accepted.some((key) => {
      const distance = rankDistance(key, role.key)
      return distance !== null && distance <= RANK_BAND_STEPS
    })).map((role) => role.key)
    const rows = await queryRows(
      `select
         p.id, p.slug, p.full_name, p.avatar_path,
         conn.id as connection_id, conn.status::text as connection_status, conn.requested_by as connection_requested_by,
         ${CANDIDATE_PROFILE_COLUMNS}
       from public.member_preferences pref
       join public.profiles p on p.id = pref.profile_id
       left join public.maritime_profiles mp on mp.user_id = p.id
       left join public.connections conn
         on conn.user_low_id = least(p.id, $1::uuid) and conn.user_high_id = greatest(p.id, $1::uuid)
         and conn.status in ('accepted', 'pending')
       where pref.open_to_recruiters = true
         and p.id <> $1::uuid
         and p.account_status = 'active'
         and p.onboarding_completed_at is not null
         and not exists (
           select 1 from public.user_blocks b
           where (b.blocker_id = $1::uuid and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = $1::uuid)
         )
         and not exists (select 1 from public.job_applications a where a.job_id = $2::uuid and a.applicant_id = p.id)
       order by (p.role_key = any($3::text[])) desc nulls last, p.updated_at desc, p.id
       limit ${POOL}`,
      [recruiterId, job.id, bandKeys],
    )
    return rows
      .map((row) => {
        // Visas never show on a public profile, so they are left out here: neither eligibility nor
        // a reason can reveal one to a recruiter the member has not applied to.
        const { match } = scoreJobForMember(publicJobView(job), { ...mapCandidateProfileRow(row as JobCandidateRow), visas: [] })
        return {
          id: String(row.id),
          slug: (row.slug as string | null) ?? null,
          fullName: String(row.full_name ?? ''),
          avatarPath: (row.avatar_path as string | null) ?? null,
          headline: (row.headline as string | null) ?? null,
          location: (row.location as string | null) ?? null,
          relationship: relationshipFor(row, recruiterId),
          match,
        }
      })
      .filter((candidate) => candidate.match.eligible && candidate.match.score !== null && !candidate.match.seaJobForOtherProfileType)
      .sort((left, right) => (right.match.score ?? 0) - (left.match.score ?? 0) || left.id.localeCompare(right.id))
      .slice(0, limit)
  }

  return { list }
}

export const jobCandidateSuggestions = createJobCandidateSuggestions()
