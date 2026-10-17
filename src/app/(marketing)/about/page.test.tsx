import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAboutPageContent: vi.fn(), getMemberNumbers: vi.fn() }))

vi.mock('@/features/site-settings/queries', () => ({ getAboutPageContent: mocks.getAboutPageContent, getMemberNumbers: mocks.getMemberNumbers }))
vi.mock('@/features/site-settings/images', () => ({ signedAboutImageUrls: async () => ({ 'site/about/11111111-1111-4111-8111-111111111111.png': 'https://media.example.com/logo.png' }) }))

import AboutPage from './page'

const EMPTY = { founders: [], team: [], partners: [], memberNumbers: { enabled: false, members: true, organizations: true, courses: true } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAboutPageContent.mockResolvedValue(EMPTY)
  mocks.getMemberNumbers.mockResolvedValue([])
})
afterEach(() => cleanup())

describe('/about (round H, H7)', () => {
  it('leaves out every section the owner has not filled in', async () => {
    render(await AboutPage())
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })

  it('shows founders, team, partner logos and the live numbers from Admin › Site settings', async () => {
    mocks.getAboutPageContent.mockResolvedValue({
      ...EMPTY,
      founders: [{ name: 'Placeholder Founder', role: 'Founder', bio: 'Placeholder bio.', photoPath: null, profileUrl: '/people/placeholder-founder' }],
      team: [{ name: 'Placeholder Teammate', role: 'Operations', bio: '', photoPath: null, profileUrl: 'https://example.com/teammate' }],
      partners: [
        { name: 'Placeholder Partner', logoPath: 'site/about/11111111-1111-4111-8111-111111111111.png', websiteUrl: 'https://example.com' },
        { name: 'Placeholder Partner Without Logo', logoPath: null, websiteUrl: null },
      ],
      memberNumbers: { enabled: true, members: true, organizations: false, courses: false },
    })
    mocks.getMemberNumbers.mockResolvedValue([{ key: 'members', value: 1234, label: 'members' }])
    render(await AboutPage())

    const founders = screen.getByRole('region', { name: 'Founders' })
    expect(within(founders).getByRole('link', { name: 'Placeholder Founder' })).toHaveAttribute('href', '/people/placeholder-founder')
    expect(within(founders).getByText('Placeholder bio.')).toBeVisible()
    const team = screen.getByRole('region', { name: 'Team' })
    expect(within(team).getByRole('link', { name: /Placeholder Teammate/ })).toHaveAttribute('target', '_blank')
    const partners = screen.getByRole('region', { name: 'Partners' })
    expect(within(partners).getByRole('img', { name: 'Placeholder Partner logo' })).toBeInTheDocument()
    expect(within(partners).getByText('Placeholder Partner Without Logo')).toBeVisible()
    const numbers = screen.getByRole('region', { name: 'Sea N Shore today' })
    expect(within(numbers).getByText('1,234')).toBeVisible()
    expect(mocks.getMemberNumbers).toHaveBeenCalledWith({ enabled: true, members: true, organizations: false, courses: false })
  })
})
