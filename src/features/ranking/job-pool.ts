import { candidatePersona, candidateRoleKeys } from '@/features/jobs/matching'
import type { JobCandidateProfile } from '@/features/jobs/types'
import type { JobPoolOptions } from '@/features/jobs/repository'
import { allRoles, roleByKey } from '@/features/roles/taxonomy'
import { RANK_BAND_STEPS, VESSEL_TYPE_SEEDS, rankDistance, vesselGroupsOf, vesselTypeCodes } from '@/features/taxonomy/maritime-taxonomy'

/**
 * Round G (G3): the SQL prefilter for Jobs for you. Jobs in the member's department come first,
 * then jobs accepting a rank within one ladder step, then jobs on a vessel type in one of the
 * member's vessel groups, then the newest. Nothing here hides a job; it only decides which 300 are
 * scored.
 */
export function jobPoolOptions(viewerId: string, profile: JobCandidateProfile | null): JobPoolOptions {
  if (!profile) return { viewerId, departmentKeys: [], rankBandKeys: [], vesselCodes: [] }
  const memberKeys = candidateRoleKeys(profile, candidatePersona(profile))
  const departmentKeys = [...new Set(memberKeys.flatMap((key) => {
    const department = roleByKey(key)?.department
    return department ? [department] : []
  }))]
  const rankBandKeys = allRoles()
    .filter((role) => !role.other && memberKeys.some((key) => {
      const distance = rankDistance(key, role.key)
      return distance !== null && distance <= RANK_BAND_STEPS
    }))
    .map((role) => role.key)
  const historyCodes = (profile.experiences ?? []).flatMap((experience) => (experience.vesselTypeCode ? [experience.vesselTypeCode] : []))
  const groups = new Set(vesselGroupsOf([...(profile.vesselTypeCodes ?? []), ...vesselTypeCodes(profile.vesselTypes), ...historyCodes]))
  const vesselCodes = VESSEL_TYPE_SEEDS.filter((entry) => groups.has(entry.group)).map((entry) => entry.code)
  return { viewerId, departmentKeys, rankBandKeys, vesselCodes }
}
