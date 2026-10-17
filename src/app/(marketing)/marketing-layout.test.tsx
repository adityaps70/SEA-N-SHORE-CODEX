import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pathname: '/pricing',
  getVerifiedUser: vi.fn(),
  getAppChromeData: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))
vi.mock('@/components/navigation/app-chrome-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/navigation/app-chrome-data')>()),
  getAppChromeData: mocks.getAppChromeData,
}))
vi.mock('@/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => <span>Notifications</span>,
}))
vi.mock('@/features/realtime/provider', () => ({
  MessagingRealtimeProvider: ({ viewerProfileId, children }: { viewerProfileId: string; children: React.ReactNode }) => (
    <div data-testid="realtime" data-viewer={viewerProfileId}>{children}</div>
  ),
}))
vi.mock('@/features/messaging/components/messaging-dock', () => ({
  MessagingDock: ({ viewerId }: { viewerId: string }) => <div data-testid="messaging-dock-spacer" data-viewer={viewerId} />,
}))
vi.mock('@/features/newsletter/components/newsletter-footer-signup', () => ({
  NewsletterFooterSignup: () => <form aria-label="Newsletter sign-up" />,
}))

import MarketingLayout from './layout'
import { MainLandmark } from '@/components/layout/main-landmark'

const MEMBER = { id: '11111111-1111-4111-8111-111111111111', cognitoSub: 'sub-member', email: 'member@example.com' }

const CHROME = {
  notificationUnreadCount: 2,
  messagingUnreadCount: 3,
  canAccessAdmin: false,
  viewer: { name: 'Test Member', avatarUrl: null, headline: null, organization: null, location: null, profileCompletion: null },
  organizations: [],
  organizationCount: 0,
  pendingConnectionRequestCount: 0,
  liveSearch: false,
}

async function renderLayout(pathname: string) {
  mocks.pathname = pathname
  return render(await MarketingLayout({ children: <main>Pricing page</main> }))
}

function expectMemberChrome() {
  // The full app header (primary destinations and the account menu), not the cut-down Home / My Profile one.
  const header = document.querySelector('[data-app-header]') as HTMLElement
  expect(header).not.toBeNull()
  const primary = within(header).getByRole('navigation', { name: 'Main' })
  expect(within(primary).getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/jobs')
  expect(within(header).getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Public navigation' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'My Profile' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
  // Phone bars.
  expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
  expect(document.querySelector('[data-phone-tabbar]')).not.toBeNull()
}

beforeEach(() => {
  mocks.getVerifiedUser.mockResolvedValue(null)
  mocks.getAppChromeData.mockResolvedValue(CHROME)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('marketing layout (Round H, H6)', () => {
  it('gives a member on /pricing the app header, phone bars, one site footer and the Messaging dock', async () => {
    mocks.getVerifiedUser.mockResolvedValue(MEMBER)
    await renderLayout('/pricing')

    expect(screen.getByText('Pricing page')).toBeInTheDocument()
    expectMemberChrome()
    expect(mocks.getAppChromeData).toHaveBeenCalledWith(MEMBER)
    expect(screen.getByTestId('realtime')).toHaveAttribute('data-viewer', MEMBER.id)

    const footers = screen.getAllByRole('contentinfo')
    expect(footers).toHaveLength(1)
    expect(footers[0]).toHaveAttribute('aria-label', 'Site footer')
    expect(within(footers[0]).getByRole('form', { name: 'Newsletter sign-up' })).toBeInTheDocument()
    expect(within(footers[0]).getByRole('link', { name: 'Your data & privacy' })).toBeInTheDocument()

    // The dock follows the footer, so its in-flow spacer keeps the bar clear of the footer's last line.
    const spacer = screen.getByTestId('messaging-dock-spacer')
    expect(footers[0].compareDocumentPosition(spacer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each(['/about', '/contact', '/help', '/'])('gives a member the same app chrome on %s', async (pathname) => {
    mocks.getVerifiedUser.mockResolvedValue(MEMBER)
    await renderLayout(pathname)
    expectMemberChrome()
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
  })

  it('gives a signed-out visitor the public header (Sign in / Join only) and the site footer', async () => {
    await renderLayout('/pricing')

    const nav = screen.getByRole('navigation', { name: 'Public navigation' })
    expect(within(nav).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Sign in', '/auth/sign-in'],
      ['Join Sea N Shore', '/auth/sign-up'],
    ])
    expect(document.querySelector('[data-app-header]')).toBeNull()
    expect(screen.queryByTestId('realtime')).not.toBeInTheDocument()
    expect(screen.queryByTestId('messaging-dock-spacer')).not.toBeInTheDocument()
    expect(mocks.getAppChromeData).not.toHaveBeenCalled()

    const footers = screen.getAllByRole('contentinfo')
    expect(footers).toHaveLength(1)
    expect(within(footers[0]).getByRole('form', { name: 'Newsletter sign-up' })).toBeInTheDocument()
    expect(within(footers[0]).queryByRole('link', { name: 'Your data & privacy' })).not.toBeInTheDocument()
  })

  it('leaves the landing page to draw its own header and footer for signed-out visitors', async () => {
    await renderLayout('/')
    expect(screen.queryByRole('navigation', { name: 'Public navigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  })

  it('still renders for a signed-out visitor when auth resolution fails', async () => {
    mocks.getVerifiedUser.mockRejectedValue(new Error('cognito down'))
    await renderLayout('/pricing')
    expect(screen.getByRole('navigation', { name: 'Public navigation' })).toBeInTheDocument()
    expect(screen.getByText('Pricing page')).toBeInTheDocument()
  })

  it.each([['a member', MEMBER], ['a visitor', null]])('gives %s a skip link first and exactly one main landmark (Round H, H8)', async (_who, viewer) => {
    mocks.getVerifiedUser.mockResolvedValue(viewer)
    mocks.pathname = '/pricing'
    const { container } = render(await MarketingLayout({ children: <MainLandmark className="page-box">Pricing page</MainLandmark> }))

    const mains = container.querySelectorAll('main')
    expect(mains).toHaveLength(1)
    expect(mains[0]).toHaveAttribute('id', 'main-content')
    expect(mains[0]).toHaveTextContent('Pricing page')
    // The page's own MainLandmark becomes a plain box inside the shell's main.
    expect(container.querySelector('.page-box')?.tagName).toBe('DIV')
    const firstFocusable = container.querySelector('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')
    expect(firstFocusable).toHaveTextContent('Skip to content')
    expect(firstFocusable).toHaveAttribute('href', '#main-content')
  })

  it('keeps the member chrome with plain defaults when the counts or profile cannot be loaded', async () => {
    mocks.getVerifiedUser.mockResolvedValue(MEMBER)
    mocks.getAppChromeData.mockRejectedValue(new Error('database down'))
    await renderLayout('/pricing')
    expectMemberChrome()
    expect(screen.getByText('Pricing page')).toBeInTheDocument()
  })
})
