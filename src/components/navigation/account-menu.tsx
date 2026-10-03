import { Building2, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react'
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
 * The desktop account menu. On phones the side drawer (side-drawer.tsx) carries these
 * entries, and more, instead.
 */
export function accountMenuItems({
  canAccessAdmin = false,
  organizations = [],
  organizationCount = organizations.length,
}: {
  canAccessAdmin?: boolean
  organizations?: HeaderOrganization[]
  organizationCount?: number
}): HeaderMenuItem[] {
  return [
    { href: '/profile', label: 'Profile', description: 'View and edit your Maritime Passport', icon: <UserRound className="size-4" /> },
    { href: '/organizations', label: 'Organizations', description: ORGANIZATIONS_DESCRIPTION, icon: <Building2 className="size-4" /> },
    ...organizationMenuItems(organizations, organizationCount),
    ...(canAccessAdmin
      ? [{ href: '/admin', label: 'Admin', description: 'Platform administration', icon: <ShieldCheck className="size-4" /> }]
      : []),
    { href: '/settings', label: 'Settings', description: 'Account, privacy, activity and data', icon: <Settings className="size-4" /> },
  ]
}

/**
 * Sign out. `menu` is the desktop account-menu row; `drawer` is the 52px row in the phone
 * side drawer (a dialog, so it is a plain button there, not a menu item).
 */
export function AccountMenuSignOut({ variant = 'menu' }: { variant?: 'menu' | 'drawer' }) {
  const drawer = variant === 'drawer'
  return (
    <form action={signOut}>
      <button
        type="submit"
        role={drawer ? undefined : 'menuitem'}
        className={drawer
          ? 'flex min-h-13 w-full cursor-pointer items-center gap-4 px-5 text-left text-base font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500'
          : 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'}
      >
        <LogOut aria-hidden="true" className={drawer ? 'size-6 shrink-0 text-navy-900' : 'size-4 text-muted'} strokeWidth={drawer ? 1.75 : undefined} />
        Sign out
      </button>
    </form>
  )
}
