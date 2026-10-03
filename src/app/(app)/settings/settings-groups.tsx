import Link from 'next/link'
import {
  Activity,
  Ban,
  BadgeCheck,
  Banknote,
  Building2,
  ChevronRight,
  Crown,
  Download,
  EyeOff,
  LayoutGrid,
  Lock,
  Mail,
  ShieldCheck,
  Trash2,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

type SettingsRowItem = {
  href: string
  label: string
  icon: LucideIcon
  value?: string | null
  tone?: 'danger'
}

type SettingsGroup = { title: string; rows: SettingsRowItem[]; note?: string }

/** Phone Settings (round 8): grouped rows with icon, label, current value and chevron. */
export function settingsGroups(input: { planLabel: string | null }): SettingsGroup[] {
  return [
    {
      title: 'Account',
      rows: [
        { href: '/profile/edit', label: 'Profile information', icon: UserRound },
        { href: '/settings/billing', label: 'Plan & billing', icon: Crown, value: input.planLabel },
        { href: '/settings/earnings', label: 'Earnings', icon: Wallet },
        { href: '/settings/payouts', label: 'Payout details', icon: Banknote },
        { href: '/settings/verifications', label: 'Verifications', icon: BadgeCheck },
        { href: '/creator', label: 'Creator access', icon: LayoutGrid },
        { href: '/organizations', label: 'Organizations', icon: Building2 },
      ],
    },
    {
      title: 'Sign in & security',
      rows: [
        { href: '/auth/forgot-password', label: 'Password & Google sign-in', icon: Lock },
      ],
      note: 'Sensitive account actions ask you to confirm it’s you again.',
    },
    {
      title: 'Visibility & activity',
      rows: [
        { href: '/activities', label: 'My Activities', icon: Activity },
        { href: '/activities?tab=hidden', label: 'Hidden posts', icon: EyeOff },
        { href: '/settings/blocked', label: 'Blocked members', icon: Ban },
      ],
    },
    {
      title: 'Communications',
      rows: [{ href: '/newsletter', label: 'Newsletter', icon: Mail }],
    },
    {
      title: 'Data & privacy',
      rows: [
        { href: '#download-data', label: 'Download my data', icon: Download },
        { href: '/privacy', label: 'Privacy policy', icon: ShieldCheck },
        { href: '#delete-account', label: 'Delete account', icon: Trash2, tone: 'danger' },
      ],
    },
  ]
}

export function PhoneSettingsList({ groups }: { groups: SettingsGroup[] }) {
  return (
    <nav aria-label="Settings" className="-mx-4 md:hidden">
      {groups.map((group) => (
        <section key={group.title} aria-labelledby={`settings-group-${group.title}`} className="mb-2 bg-white">
          <h2 id={`settings-group-${group.title}`} className="px-4 pb-1 pt-4 text-[13px] font-bold uppercase tracking-[0.08em] text-muted">
            {group.title}
          </h2>
          <ul>
            {group.rows.map((row) => {
              const Icon = row.icon
              const danger = row.tone === 'danger'
              return (
                <li key={row.href}>
                  <Link
                    href={row.href}
                    className={`flex min-h-14 items-center gap-4 px-4 text-base transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500 ${danger ? 'text-red-700' : 'text-navy-950'}`}
                  >
                    <Icon aria-hidden="true" className="size-6 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    {row.value ? <span className="shrink-0 text-sm text-muted">{row.value}</span> : null}
                    <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
                  </Link>
                </li>
              )
            })}
          </ul>
          {group.note ? <p className="px-4 pb-3 text-xs leading-5 text-muted">{group.note}</p> : null}
        </section>
      ))}
    </nav>
  )
}

export type { SettingsGroup, SettingsRowItem }
