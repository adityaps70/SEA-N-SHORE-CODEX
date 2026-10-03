import { BadgeQuestionMark, BookOpenCheck, BriefcaseBusiness, GraduationCap, LifeBuoy, Lightbulb, Newspaper, ShieldCheck, Trophy, UsersRound, Wrench, type LucideIcon, type LucideProps } from 'lucide-react'
import { GROUP_ICON_NAMES, type CommunityCategory, type GroupIconName } from './types'

const ICONS: Record<GroupIconName, LucideIcon> = {
  ShieldCheck,
  UsersRound,
  Wrench,
  BookOpenCheck,
  BadgeQuestionMark,
  Newspaper,
  BriefcaseBusiness,
  LifeBuoy,
  Trophy,
  GraduationCap,
  Lightbulb,
}

export const GROUP_ICON_LABELS: Record<GroupIconName, string> = {
  ShieldCheck: 'Shield (safety, vetting)',
  UsersRound: 'People (peer group)',
  Wrench: 'Wrench (technical)',
  BookOpenCheck: 'Book (learning, cadets)',
  BadgeQuestionMark: 'Question badge (Q&A)',
  Newspaper: 'Newspaper (news)',
  BriefcaseBusiness: 'Briefcase (careers)',
  LifeBuoy: 'Lifebuoy (safety lessons)',
  Trophy: 'Trophy (achievements)',
  GraduationCap: 'Graduation cap (learning)',
  Lightbulb: 'Light bulb (opinion, ideas)',
}

/** Round 10: the icon shown for each category (the same icons migration 0061 gives the category communities). */
export const COMMUNITY_CATEGORY_ICONS: Record<CommunityCategory, GroupIconName> = {
  maritime_news: 'Newspaper',
  technical_discussion: 'Wrench',
  vetting_sire_2_0: 'ShieldCheck',
  career_advice: 'BriefcaseBusiness',
  safety_lessons: 'LifeBuoy',
  achievement: 'Trophy',
  learning: 'GraduationCap',
  industry_opinion: 'Lightbulb',
}

export function isGroupIconName(value: string | null | undefined): value is GroupIconName {
  return (GROUP_ICON_NAMES as readonly string[]).includes(value ?? '')
}

/** The lucide icon for a stored icon name; unknown or missing names fall back to UsersRound. */
export function groupIcon(name: string | null | undefined): LucideIcon {
  return isGroupIconName(name) ? ICONS[name] : UsersRound
}

/** Renders the stored icon name (UsersRound when unknown) with the usual lucide props. */
export function GroupIcon({ icon, ...props }: LucideProps & { icon: string | null | undefined }) {
  const Icon = isGroupIconName(icon) ? ICONS[icon] : UsersRound
  return <Icon {...props} />
}
