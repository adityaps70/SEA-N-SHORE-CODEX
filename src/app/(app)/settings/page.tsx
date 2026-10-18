import type { Metadata } from 'next'
import Link from 'next/link'
import {
  BadgeCheck,
  Ban,
  BellRing,
  Building2,
  ChevronRight,
  CreditCard,
  History,
  KeyRound,
  Landmark,
  LockKeyhole,
  Mail,
  MonitorSmartphone,
  ShieldCheck,
  SquarePlus,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { getAccessContext } from '@/features/access/server'
import { DataExportPanel } from '@/features/account-export/components/data-export-panel'
import { DeleteAccountSection } from '@/features/account-deletion/components/delete-account-section'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { PhoneSettingsList, settingsGroups } from './settings-groups'

export const metadata: Metadata = { title: 'Settings' }

/** The desktop Account & privacy cards. */
const SETTINGS_CARDS: Array<{ href: string; title: string; description: string; icon?: LucideIcon }> = [
  { href: '/activities', title: 'My Activities', icon: History, description: 'Your posts, comments, job applications, events and learning.' },
  { href: '/settings/billing', title: 'Membership & billing', icon: CreditCard, description: 'Review Free, Creator Pro and Organization Pro access.' },
  { href: '/settings/earnings', title: 'Earnings', icon: Wallet, description: 'See ticket and course sales, the platform fee, your balance and payouts.' },
  { href: '/settings/payouts', title: 'Payout details', icon: Landmark, description: 'Add the bank account or UPI ID where Sea N Shore pays your earnings.' },
  { href: '/settings/verifications', title: 'Professional verifications', icon: BadgeCheck, description: 'Apply for or review Recruiter, Trainer and Event Host verification.' },
  { href: '/organizations', title: 'Organizations', icon: Building2, description: 'Create, claim or manage organization workspaces and roles.' },
  { href: '/creator', title: 'Creator access', icon: SquarePlus, description: 'See publishing readiness for Jobs, Events and LMS in one place.' },
  { href: '/settings/notifications', title: 'Email notifications', icon: BellRing, description: 'Choose which emails you get: messages, connection requests, comments, mentions, jobs and learning.' },
  { href: '/newsletter', title: 'Newsletter', icon: Mail, description: 'Subscribe, choose topics or unsubscribe from Sea N Shore emails.' },
  { href: '/settings/blocked', title: 'Blocked & muted', icon: Ban, description: 'See the people you blocked or muted, and undo either.' },
  { href: '/settings/privacy', title: 'Privacy settings', description: 'Choose who can find you, message you and see your connections.' },
  { href: '/privacy', title: 'Privacy policy', description: 'Read how profile, community, jobs, learning, and messaging data is used.' },
  { href: '/settings/account', title: 'Password, email & sessions', icon: MonitorSmartphone, description: 'Change your password or email, sign out other devices and get 2FA backup codes.' },
  { href: '/settings/security', title: 'Two-step verification', icon: KeyRound, description: 'Add an authenticator app code to your password sign-in.' },
]

/**
 * Round H (H8): a card link named by its title alone ("Earnings"), with the line under it as its description,
 * instead of one long name made of the title and the whole description.
 */
function SettingsCard({ href, title, description, icon: Icon }: (typeof SETTINGS_CARDS)[number]) {
  const id = `settings-card-${href.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`
  return (
    <Link
      href={href}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="group relative rounded-xl border border-mist-200 bg-white p-4 pr-10 transition hover:border-ocean-300 hover:bg-ocean-50/40 hover:shadow-sm"
    >
      <div className="flex items-center gap-2">
        {Icon ? <Icon aria-hidden="true" className="size-4 text-ocean-700" /> : null}
        <p id={`${id}-title`} className="font-semibold text-navy-950">{title}</p>
      </div>
      <p id={`${id}-description`} className="mt-1 text-sm leading-5 text-muted">{description}</p>
      <ChevronRight aria-hidden="true" className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted transition group-hover:translate-x-0.5 group-hover:text-ocean-700" />
    </Link>
  )
}

export default async function SettingsPage() {
  const user = await requireAwsUser()
  // The plan label is a convenience on the phone list; Settings must render without it.
  const access = await getAccessContext(user.id).catch(() => null)
  const planLabel = access ? (access.personalPlan === 'creator_pro' ? 'Creator Pro' : 'Free') : null
  const groups = settingsGroups({ planLabel })

  return (
    <section className="mx-auto grid max-w-page-narrow gap-5 py-2 max-md:gap-0 max-md:py-0 sm:py-5">
      <MobilePageBar backHref="/home" title="Settings" />
      <PhoneSettingsList groups={groups} />

      <header className="max-md:hidden">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Account</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Manage your account security, privacy, and permanent account actions from one place.
        </p>
      </header>

      <section className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:hidden sm:p-6">
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-navy-950">Account & privacy</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Review how your account is protected and how your information is handled across Sea N Shore.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {SETTINGS_CARDS.map((card) => <SettingsCard key={card.href} {...card} />)}
        </div>
        <p className="mt-4 flex items-start gap-2 text-sm leading-5 text-muted">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ocean-700" />
          <span><span className="font-semibold text-navy-950">Security:</span> sensitive account actions require a fresh password verification.</span>
        </p>
      </section>

      {/* Phones reach these panels from the list above (#download-data, #delete-account). */}
      <div id="your-data" className="grid scroll-mt-24 gap-5 max-md:mt-5">
        <h2 className="sr-only">Your data and privacy controls</h2>
        <div id="download-data" className="scroll-mt-24">
          <DataExportPanel />
        </div>
        <div id="delete-account" className="scroll-mt-24">
          <DeleteAccountSection />
        </div>
      </div>
    </section>
  )
}
