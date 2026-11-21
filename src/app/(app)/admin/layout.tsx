import { notFound } from 'next/navigation'
import {
  Activity,
  BadgeCheck,
  Building2,
  CreditCard,
  Film,
  Globe2,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  MailPlus,
  Settings,
  SlidersHorizontal,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { ActiveNavLink } from '@/components/navigation/active-nav-link'
import { requireAdminAccess, type AdminAccess } from '@/features/admin/admin-access'
import Link from 'next/link'
import { AdminMobileBar } from '@/features/admin/components/admin-mobile-bar'
import { BACKUP_CODES_HREF, BACKUP_CODES_REMINDER, needsBackupCodes } from '@/features/account-security/backup-code-reminder'
import { adminRepository, type AdminDashboardMetrics } from '@/features/admin/repository'

type Section = {
  href: string
  label: string
  icon: typeof LayoutDashboard
  count?: (metrics: AdminDashboardMetrics) => number
}

const sections: Section[] = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/moderation', label: 'Moderation', icon: ShieldAlert, count: (m) => m.openReports + m.reviewingReports },
  { href: '/admin/users', label: 'Users', icon: UsersRound },
  // Round GP: registered members, organizations and jobs per country.
  { href: '/admin/countries', label: 'Members by country', icon: Globe2 },
  // Round GP (Part C): limited admins for country partners (platform administrators only).
  { href: '/admin/country-admins', label: 'Country admins', icon: UserCog },
  { href: '/admin/organizations', label: 'Organizations', icon: Building2, count: (m) => m.pendingOrganizations },
  { href: '/admin/communities', label: 'Communities', icon: UsersRound },
  { href: '/admin/verifications', label: 'Verifications', icon: BadgeCheck },
  { href: '/admin/access', label: 'Access requests', icon: KeyRound, count: (m) => m.pendingAccessRequests },
  // Round H (H7): Contact page requests, and the owner-edited Contact and About page content.
  { href: '/admin/support', label: 'Support', icon: LifeBuoy },
  { href: '/admin/learning', label: 'Learning', icon: GraduationCap },
  { href: '/admin/billing', label: 'Billing', icon: CreditCard },
  { href: '/admin/payments', label: 'Payments', icon: Wallet },
  { href: '/admin/newsletter', label: 'Newsletter', icon: Mail },
  { href: '/admin/legacy-invites', label: 'Legacy invites', icon: MailPlus },
  { href: '/admin/ranking', label: 'Ranking', icon: SlidersHorizontal },
  { href: '/admin/ranking/health', label: 'Ranking health', icon: Activity },
  { href: '/admin/deleted-content', label: 'Deleted content', icon: Trash2 },
  { href: '/admin/media', label: 'Video posters', icon: Film },
  { href: '/admin/settings', label: 'Site settings', icon: Settings },
  { href: '/admin/audit', label: 'Audit log', icon: Activity },
]

// Round GP (Part C): all a country admin sees: their countries' organization reviews and numbers.
const countryAdminSections: Section[] = [
  { href: '/admin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/admin/countries', label: 'Members by country', icon: Globe2 },
]

// Phones (round 8): the section nav is a scrolling chip row, selected = navy-950 filled.
const linkClass = 'group flex min-h-10 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold text-navy-900 transition hover:bg-mist-50 max-md:min-h-9 max-md:gap-1.5 max-md:rounded-full max-md:border max-md:border-mist-300 max-md:bg-white max-md:px-3.5 max-md:focus-visible:outline max-md:focus-visible:outline-2 max-md:focus-visible:outline-offset-2 max-md:focus-visible:outline-ocean-500'
const activeLinkClass = 'bg-ocean-50 text-ocean-800 hover:bg-ocean-50 max-md:!border-navy-950 max-md:!bg-navy-950 max-md:!text-white'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Round GP (Part C): platform administrators and country admins may enter; each page then checks its own area
  // (admin-access.ts), so a country admin who types another admin address still gets nothing.
  let access: AdminAccess
  try {
    access = await requireAdminAccess('country')
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') notFound()
    throw error
  }

  // Queue counts are a convenience; the console must still render if they fail. Country admins see none of them.
  const metrics = access.kind === 'platform'
    ? await adminRepository.getAdminDashboardMetrics(access.user.id).catch(() => null)
    : null
  const visibleSections = access.kind === 'platform' ? sections : countryAdminSections
  // Admin two-step (owner, 21 Nov): a reminder for admins with no unused backup codes.
  const remindBackupCodes = await needsBackupCodes(access.user.id)

  return (
    <>
    <AdminMobileBar sections={visibleSections.map(({ href, label }) => ({ href, label }))} />
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 max-md:gap-3 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start">
      <aside className="min-w-0 lg:sticky lg:top-24">
        <p className="mb-2 hidden items-center gap-2 px-3 text-xs font-bold uppercase tracking-[0.14em] text-muted lg:flex">
          <ShieldCheck aria-hidden="true" className="size-4 text-ocean-700" />
          {access.kind === 'platform' ? 'Sea N Shore Admin' : `Country admin · ${access.countries.join(', ')}`}
        </p>
        <nav
          aria-label="Admin navigation"
          className="-mx-4 flex gap-1 overflow-x-auto border-b border-mist-100 px-4 pb-2 max-md:gap-2 max-md:pb-3 max-md:[scrollbar-width:none] lg:mx-0 lg:flex-col lg:overflow-visible lg:border-b-0 lg:px-0 lg:pb-0 max-md:[&::-webkit-scrollbar]:hidden"
        >
          {visibleSections.map((section) => {
            const Icon = section.icon
            const count = metrics && section.count ? section.count(metrics) : 0
            return (
              <ActiveNavLink
                key={section.href}
                href={section.href}
                exact={section.href === '/admin'}
                className={linkClass}
                activeClassName={activeLinkClass}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted group-aria-[current=page]:text-ocean-700 max-md:hidden" />
                <span className="whitespace-nowrap">{section.label}</span>
                {count > 0 ? (
                  <span
                    aria-label={`${count} waiting`}
                    className="ml-auto rounded-full bg-red-600 px-1.5 text-xs font-bold leading-5 text-white"
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                ) : null}
              </ActiveNavLink>
            )
          })}
        </nav>
      </aside>
      <div className="min-w-0">
        {remindBackupCodes ? (
          <p role="note" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {BACKUP_CODES_REMINDER} <Link href={BACKUP_CODES_HREF} className="font-semibold underline">Create backup codes</Link>
          </p>
        ) : null}
        {children}
      </div>
    </div>
    </>
  )
}
