import { personaForProfile } from '@/features/profiles/profile-persona-rules'
import type { PublicProfile } from '@/features/profiles/types'
import { profileNeedsRankSelection } from '../taxonomy'
import { RankSelectionBanner } from './rank-selection-banner'

/** The "Select your rank" banner, only for profiles that need it (round 12). */
export function RankSelectionPrompt({ profile, className = '' }: { profile: PublicProfile; className?: string }) {
  if (!profileNeedsRankSelection(profile)) return null
  return (
    <div className={className}>
      <RankSelectionBanner
        persona={personaForProfile(profile)}
        initial={{
          roleDepartmentKey: profile.roleDepartmentKey,
          roleKey: profile.roleKey,
          roleOtherText: profile.roleOtherText,
          cadetStageKey: profile.cadetStageKey,
          cadetCourseKey: profile.cadetCourseKey,
          targetDepartmentKey: profile.targetDepartmentKey,
          targetRoleKey: profile.targetRoleKey,
          legacyRank: profile.roleKey ? null : profile.rank,
        }}
      />
    </div>
  )
}
