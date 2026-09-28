import { Building2, CalendarDays, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { signOut } from '@/features/auth/actions'
import { OrganizationLogo } from '@/features/profiles/components/organization-logo'
import type { HeaderMenuItem } from './header-menu'

/** An organization the member belongs to, for the account menu. */
export type HeaderOrganization = {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  /** Any role other than plain member opens the Manage page (roles, requests, plan). */
  canManage: boolean
}

export const ORGANIZATIONS_DESCRIPTION = 'Your pages, access requests and discovery'

/** Account-menu entries for the member's organizations (at most a few; the rest are one click away). */
export function organizationMenuItems(organizations: HeaderOrganization[], total = organizations.length): HeaderMenuItem[] {
  if (!organizations.length) return []
  const group = 'Your organizations'
  return [
    ...organizations.map((organization): HeaderMenuItem => ({
      href: `/organizations/${organization.slug}`,
      label: organization.name,
      icon: <OrganizationLogo logoUrl={organization.logoUrl} size="xs" />,
      group,
      secondary: organization.canManage
        ? { href: `/organizations/${organization.slug}/manage`, label: 'Manage', accessibleLabel: `Manage ${organization.name}` }
        : undefined,
    })),
    ...(total > organizations.length
      ? [{ href: '/organizations#your-pages', label: `See all ${total} organizations`, group, tone: 'link' as const }]
      : []),
  ]
}

/**
 * The account menu, shared by the desktop header and the phone header.
 * Phones have no Events tab in the bottom bar, so `includeEvents` adds it here.
 */
export function accountMenuItems({
  canAccessAdmin = false,
  organizations = [],
  organizationCount = organizations.length,
  includeEvents = false,
}: {
  canAccessAdmin?: boolean
  organizations?: HeaderOrganization[]
  organizationCount?: number
  includeEvents?: boolean
}): HeaderMenuItem[] {
  return [
    { href: '/profile', label: 'Profile', description: 'View and edit your Maritime Passport', icon: <UserRound className="size-4" /> },
    ...(includeEvents
      ? [{ href: '/events', label: 'Events', description: 'Webinars, meetups and conferences', icon: <CalendarDays className="size-4" /> }]
      : []),
    { href: '/organizations', label: 'Organizations', description: ORGANIZATIONS_DESCRIPTION, icon: <Building2 className="size-4" /> },
    ...organizationMenuItems(organizations, organizationCount),
    ...(canAccessAdmin
      ? [{ href: '/admin', label: 'Admin', description: 'Platform administration', icon: <ShieldCheck className="size-4" /> }]
      : []),
    { href: '/settings', label: 'Settings', description: 'Account, privacy, activity and data', icon: <Settings className="size-4" /> },
  ]
}

export function AccountMenuSignOut() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        role="menuitem"
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
      >
        <LogOut aria-hidden="true" className="size-4 text-muted" />
        Sign out
      </button>
    </form>
  )
}
