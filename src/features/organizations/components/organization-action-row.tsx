import { Crown, ExternalLink, MessagesSquare, Settings2 } from 'lucide-react'
import Link from '@/components/navigation/intent-link'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import { StartConversationButton } from '@/features/messaging/components/start-conversation-button'
import { cn } from '@/lib/cn'
import { USER_WEBSITE_REL, userWebsiteHref } from '@/lib/user-website'
import { organizationHeaderActions, type OrganizationHeaderAction } from '../organization-header-actions'
import { OrganizationFollowButton } from './organization-follow-button'
import { OrganizationPageMenu, type OrganizationMenuAction, type OrganizationMenuLink } from './organization-page-menu'

type Emphasis = 'primary' | 'secondary'

const MENU_ACTIONS: readonly OrganizationHeaderAction[] = ['website', 'message', 'createCommunity', 'upgrade']

function isMenuAction(action: OrganizationHeaderAction | undefined): action is OrganizationMenuAction {
  return Boolean(action && MENU_ACTIONS.includes(action))
}

/** Phones: the visible buttons share the row as full-width pills. */
const PHONE_BUTTON = 'w-full whitespace-nowrap max-md:min-h-11 max-md:rounded-full max-md:px-3 max-md:text-[15px]'

/**
 * Round H (H6): the organization page header row. One primary action (by the viewer's role), at most
 * two secondary ones (one on phones) and the "…" menu with everything else, on one line at any width.
 * The buttons keep their server actions; only where they are shown changes.
 */
export function OrganizationActionRow({
  organization,
  following,
  followerCount,
  canManagePage,
  manageHref,
  messageProfileId,
  claimHref,
  createCommunityHref,
  upgradeHref,
  joinLink,
  leaveCompanyId,
}: {
  organization: { id: string; slug: string; name: string; website: string | null }
  following: boolean
  followerCount: number
  canManagePage: boolean
  manageHref: string
  /** The organization's contact person, when it is not the viewer. */
  messageProfileId: string | null
  /** Set when the viewer may claim this unclaimed page. */
  claimHref: string | null
  /** Set for owners and administrators. */
  createCommunityHref: string | null
  /** Set for owners and administrators on the free plan. */
  upgradeHref: string | null
  joinLink: OrganizationMenuLink | null
  leaveCompanyId: string | null
}) {
  const actions = organizationHeaderActions({
    canManagePage,
    following,
    canMessage: Boolean(messageProfileId),
    hasWebsite: Boolean(organization.website),
    canClaim: Boolean(claimHref),
    canCreateCommunity: Boolean(createCommunityHref),
    canUpgrade: Boolean(upgradeHref),
  })
  const phoneMenuAction = actions.secondary[1]
  // The menu carries the overflow at every size, and the second secondary action on phones.
  const inMenu = (action: OrganizationMenuAction) => actions.overflow.includes(action) || phoneMenuAction === action

  function renderAction(action: OrganizationHeaderAction, emphasis: Emphasis) {
    const linkClass = cn(emphasis === 'primary' ? primaryButtonClass : secondaryButtonClass, PHONE_BUTTON)
    switch (action) {
      case 'manage':
        return <Link href={manageHref} className={linkClass}><Settings2 aria-hidden="true" className="size-4 shrink-0" /> Manage page</Link>
      case 'follow':
        return <OrganizationFollowButton companyId={organization.id} initialFollowing={following} initialFollowerCount={followerCount} appearance="page" emphasis={emphasis} />
      case 'message':
        return messageProfileId
          ? <StartConversationButton targetProfileId={messageProfileId} variant={emphasis === 'primary' ? 'default' : 'secondary'} className="whitespace-nowrap max-md:min-h-11 max-md:rounded-full max-md:px-3 max-md:text-[15px]" />
          : null
      case 'website':
        return userWebsiteHref(organization.website) ? (
          <a href={userWebsiteHref(organization.website)!} target="_blank" rel={USER_WEBSITE_REL} className={linkClass}>
            Visit website <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null
      case 'claim':
        return claimHref ? <Link href={claimHref} className={linkClass}>Claim this page</Link> : null
      case 'createCommunity':
        return createCommunityHref ? <Link href={createCommunityHref} className={linkClass}><MessagesSquare aria-hidden="true" className="size-4 shrink-0" /> Create a community</Link> : null
      case 'upgrade':
        return upgradeHref ? <Link href={upgradeHref} className={linkClass}><Crown aria-hidden="true" className="size-4 shrink-0" /> Upgrade to Organization Pro</Link> : null
    }
  }

  const slots: Array<{ action: OrganizationHeaderAction; emphasis: Emphasis; phoneHidden: boolean }> = [
    { action: actions.primary, emphasis: 'primary', phoneHidden: false },
    ...actions.secondary.map((action, index) => ({ action, emphasis: 'secondary' as const, phoneHidden: index > 0 })),
  ]

  return (
    <div data-testid="organization-actions" className="mt-4 flex flex-nowrap items-center gap-2">
      {slots.map((slot) => (
        <div
          key={slot.action}
          data-header-action={slot.action}
          data-emphasis={slot.emphasis}
          className={cn('min-w-0 max-md:flex-1', slot.phoneHidden && 'max-md:hidden')}
        >
          {renderAction(slot.action, slot.emphasis)}
        </div>
      ))}
      <div className="shrink-0">
        <OrganizationPageMenu
          organizationName={organization.name}
          pagePath={`/organizations/${organization.slug}`}
          joinLink={joinLink}
          websiteHref={inMenu('website') ? organization.website : null}
          messageProfileId={inMenu('message') ? messageProfileId : null}
          createCommunityHref={inMenu('createCommunity') ? createCommunityHref : null}
          upgradeHref={inMenu('upgrade') ? upgradeHref : null}
          phoneOnlyItems={isMenuAction(phoneMenuAction) ? [phoneMenuAction] : []}
          leaveCompanyId={leaveCompanyId}
        />
      </div>
    </div>
  )
}
