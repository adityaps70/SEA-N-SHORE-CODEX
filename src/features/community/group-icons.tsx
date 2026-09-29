import { BadgeQuestionMark, BookOpenCheck, ShieldCheck, UsersRound, Wrench, type LucideIcon, type LucideProps } from 'lucide-react'
import { GROUP_ICON_NAMES, type GroupIconName } from './types'

const ICONS: Record<GroupIconName, LucideIcon> = {
  ShieldCheck,
  UsersRound,
  Wrench,
  BookOpenCheck,
  BadgeQuestionMark,
}

export const GROUP_ICON_LABELS: Record<GroupIconName, string> = {
  ShieldCheck: 'Shield (safety, vetting)',
  UsersRound: 'People (peer group)',
  Wrench: 'Wrench (technical)',
  BookOpenCheck: 'Book (learning, cadets)',
  BadgeQuestionMark: 'Question badge (Q&A)',
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
