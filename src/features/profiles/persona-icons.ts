import {
  Anchor,
  Briefcase,
  Building2,
  ClipboardCheck,
  Cpu,
  GraduationCap,
  HeartHandshake,
  Landmark,
  Sparkles,
  TrendingUp,
  UserRound,
  UserSearch,
  Users,
  Warehouse,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { Persona } from './persona'

/**
 * One icon per persona. Only sea-going people get a shipping icon; everyone
 * else gets an icon for the work they actually do.
 */
export const PERSONA_ICONS: Record<Persona, LucideIcon> = {
  seafarer: Anchor,
  shore_professional: Briefcase,
  recruiter_hr: UserSearch,
  trainer_instructor: GraduationCap,
  student_cadet: GraduationCap,
  seafarer_family: HeartHandshake,
  maritime_enthusiast: Sparkles,
  other: UserRound,
}

/** Icons for the professional families of the identity catalog (profiles made before personas). */
const IDENTITY_FAMILY_ICONS: Array<{ match: RegExp; icon: LucideIcon }> = [
  { match: /^(sea-going|shipboard|offshore)/i, icon: Anchor },
  { match: /legal|insurance|finance/i, icon: Landmark },
  { match: /training|research|academy|knowledge/i, icon: GraduationCap },
  { match: /recruitment|manning/i, icon: UserSearch },
  { match: /welfare|community|industry bodies/i, icon: HeartHandshake },
  { match: /technology|data|communications/i, icon: Cpu },
  { match: /survey|class|assurance|inspection|compliance|government/i, icon: ClipboardCheck },
  { match: /ports|terminals|logistics|agency/i, icon: Warehouse },
  { match: /commercial/i, icon: TrendingUp },
  { match: /shipbuilding|technical|fuel|energy/i, icon: Wrench },
  { match: /management|operations|shipping/i, icon: Building2 },
  { match: /professional capacities/i, icon: Users },
]

export function identityFamilyIcon(family: string | null | undefined): LucideIcon | null {
  if (!family?.trim()) return null
  return IDENTITY_FAMILY_ICONS.find((entry) => entry.match.test(family))?.icon ?? null
}

/** The icon for a member's identity chip: persona first, then the legacy identity family. */
export function profileIdentityIcon(profile: {
  persona?: Persona | null
  identityRoot?: 'professional' | 'organisation' | null
  primaryIdentityFamily?: string | null
  profileType?: string | null
}): LucideIcon {
  if (profile.persona) return PERSONA_ICONS[profile.persona]
  if (profile.identityRoot === 'organisation' || profile.profileType === 'company') return Building2
  const familyIcon = identityFamilyIcon(profile.primaryIdentityFamily)
  if (familyIcon) return familyIcon
  if (profile.profileType === 'seafarer') return Anchor
  if (profile.profileType === 'trainer' || profile.profileType === 'mentor') return GraduationCap
  if (profile.profileType === 'recruiter') return UserSearch
  return Briefcase
}
