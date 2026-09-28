import Link from 'next/link'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, CreditCard, ExternalLink, Inbox, LayoutDashboard, Lock, Palette, UsersRound } from 'lucide-react'
import { organizationManageHref, organizationPlanBillingHref } from '../organization-page-profile'
import { OrganizationLogo } from './organization-logo'

export type ManageNavId = 'overview' | 'requests' | 'team' | 'branding' | 'analytics' | 'billing'

type NavItem = {
  id: ManageNavId
  label: string
  href: string
  icon: LucideIcon
  badge?: number
  locked?: boolean
}

/**
 * Frame for every "Manage page" screen: organization identity, a link back to the
 * public page and the section navigation (side bar on desktop, scrollable row on phones).
 */
export function OrganizationManageShell({
  workspace,
  active,
  summary,
  showRequests,
  pendingRequests = 0,
  locked = {},
  showBilling = false,
  children,
}: {
  workspace: { id: string; slug: string; name: string; logoPath: string | null }
  active: ManageNavId
  /** One line under the name, e.g. "Owner · Free plan". */
  summary?: string | null
  /** Requests are shown to owners, administrators and Sea N Shore reviewers. */
  showRequests: boolean
  pendingRequests?: number
  /** Sections the viewer cannot use yet; they stay reachable and explain why. */
  locked?: Partial<Record<'team' | 'branding' | 'analytics', boolean>>
  /** "Plan & billing" is shown to the owner and administrators, on the free plan too. */
  showBilling?: boolean
  children: ReactNode
}) {
  const slug = workspace.slug
  const items: NavItem[] = [
    { id: 'overview', label: 'Overview', href: organizationManageHref(slug), icon: LayoutDashboard },
    ...(showRequests ? [{ id: 'requests' as const, label: 'Requests', href: organizationManageHref(slug, 'requests'), icon: Inbox, badge: pendingRequests }] : []),
    // Early in the list so it is visible without scrolling the phone section row.
    ...(showBilling ? [{ id: 'billing' as const, label: 'Plan & billing', href: organizationPlanBillingHref(slug), icon: CreditCard }] : []),
    { id: 'team', label: 'Team & roles', href: `/organizations/${slug}/team`, icon: UsersRound, locked: locked.team },
    { id: 'branding', label: 'Branding', href: `/organizations/${slug}/branding`, icon: Palette, locked: locked.branding },
    { id: 'analytics', label: 'Analytics', href: `/organizations/${slug}/analytics`, icon: BarChart3, locked: locked.analytics },
  ]

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 py-2 sm:py-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <OrganizationLogo company={workspace} size="md" />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Manage page</p>
            <p className="truncate text-lg font-bold text-navy-950">{workspace.name}</p>
            {summary ? <p className="truncate text-sm text-muted">{summary}</p> : null}
          </div>
        </div>
        <Link
          href={`/organizations/${slug}`}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 transition hover:border-ocean-300 hover:bg-ocean-50"
        >
          View page <ExternalLink aria-hidden="true" className="size-4" />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Manage page sections" className="min-w-0 rounded-2xl border border-mist-100 bg-white p-1.5 shadow-[var(--shadow-card)] lg:sticky lg:top-24">
          <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] lg:flex-col lg:overflow-visible">
            {items.map((item) => {
              const current = item.id === active
              const Icon = item.icon
              return (
                <li key={item.id} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={`flex min-h-10 cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 ${current
                      ? 'bg-ocean-50 text-ocean-800'
                      : 'text-navy-900 hover:bg-mist-50'}`}
                  >
                    <Icon aria-hidden="true" className={`size-4 shrink-0 ${current ? 'text-ocean-700' : 'text-muted'}`} />
                    <span className="flex-1">{item.label}</span>
                    {item.locked ? <Lock aria-label="Needs Organization Pro or another role" className="size-3.5 text-muted" /> : null}
                    {item.badge ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                        {item.badge}<span className="sr-only"> waiting</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="min-w-0 space-y-4">{children}</div>
      </div>
    </div>
  )
}
