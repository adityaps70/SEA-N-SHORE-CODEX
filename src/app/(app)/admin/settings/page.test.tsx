import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), getMemberNumbers: vi.fn() }))

vi.mock('@/features/site-settings/repository', () => ({ siteSettingsRepository: { get: mocks.get } }))
vi.mock('@/features/site-settings/queries', () => ({ getMemberNumbers: mocks.getMemberNumbers }))
vi.mock('@/features/site-settings/images', () => ({ signedAboutImageUrls: async () => ({ 'site/about/11111111-1111-4111-8111-111111111111.png': 'https://media.example.com/logo.png' }) }))
vi.mock('@/features/site-settings/admin-actions', () => ({
  saveGrievanceOfficerAction: vi.fn(),
  saveAboutPageAction: vi.fn(),
  createSiteImageUploadAction: vi.fn(),
}))

import AdminSiteSettingsPage from './page'

const ABOUT = {
  founders: [],
  team: [],
  partners: [{ name: 'Placeholder Partner', logoPath: 'site/about/11111111-1111-4111-8111-111111111111.png', websiteUrl: null }],
  memberNumbers: { enabled: false, members: true, organizations: true, courses: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockImplementation(async (key: string) => (key === 'about_page' ? ABOUT : { name: '', email: '', responseTime: '' }))
  mocks.getMemberNumbers.mockResolvedValue([{ key: 'members', value: 120, label: 'members' }])
})
afterEach(() => cleanup())

describe('Admin › Site settings (round H, H7)', () => {
  it('edits the Grievance Officer and the About page sections with labelled fields', async () => {
    render(await AdminSiteSettingsPage())
    expect(screen.getByRole('heading', { name: 'Grievance Officer (Contact page)' })).toBeVisible()
    for (const label of ['Name', 'Email address', 'Response time']) expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Save Grievance Officer' })).toBeEnabled()

    expect(screen.getByRole('heading', { name: 'Founders' })).toBeVisible()
    expect(screen.getAllByText('None yet. This section is hidden on the About page.')).toHaveLength(2)
    const partners = screen.getByRole('group', { name: 'Partners' })
    expect(within(partners).getByLabelText('Name')).toHaveValue('Placeholder Partner')
    expect(within(partners).getByLabelText('Logo')).toHaveAttribute('type', 'file')
    expect(within(partners).getByRole('button', { name: 'Remove Placeholder Partner' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: /Show live member numbers/ })).not.toBeChecked()
    expect(screen.getByText(/currently 120/)).toBeInTheDocument()
  })

  it('refuses to show editable forms when the settings cannot be read', async () => {
    mocks.get.mockRejectedValue(new Error('relation does not exist'))
    render(await AdminSiteSettingsPage())
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded')
    expect(screen.queryByRole('button', { name: 'Save About page' })).not.toBeInTheDocument()
  })
})
