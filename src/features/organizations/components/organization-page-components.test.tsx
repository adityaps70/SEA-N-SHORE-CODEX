import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

const mocks = vi.hoisted(() => ({
  followOrganizationAction: vi.fn(),
  unfollowOrganizationAction: vi.fn(),
  updateOrganizationBranding: vi.fn(),
  cropImageToFile: vi.fn(),
}))

vi.mock('@/lib/images/crop-image', () => ({ cropImageToFile: mocks.cropImageToFile }))
// The cropper itself is canvas and pointer driven; here it reports one fixed crop box on load.
vi.mock('react-easy-crop', () => ({
  default: function MockCropper(props: { onCropComplete: (area: unknown, pixels: unknown) => void; cropShape: string; aspect: number }) {
    const { onCropComplete } = props
    useEffect(() => {
      onCropComplete({ x: 0, y: 0, width: 50, height: 50 }, { x: 0, y: 0, width: 600, height: 600 })
      // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once, like the media load event
    }, [])
    return <div data-testid="mock-cropper" data-shape={props.cropShape} data-aspect={String(props.aspect)} />
  },
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/organizations/oceanic' }))
vi.mock('@/features/feed/components/organization-posts-tab', () => ({
  OrganizationPostsTab: (props: { companyId: string; canPost: boolean; limit?: number }) => (
    <div data-testid="org-posts-tab" data-company={props.companyId} data-can-post={String(props.canPost)} data-limit={String(props.limit ?? '')} />
  ),
}))
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => <span data-testid="image" data-src={String(props.src)} /> }))
vi.mock('@/features/organizations/follow-actions', () => ({
  followOrganizationAction: mocks.followOrganizationAction,
  unfollowOrganizationAction: mocks.unfollowOrganizationAction,
}))
vi.mock('@/features/organizations/workspace-actions', () => ({ updateOrganizationBranding: mocks.updateOrganizationBranding }))

import { OrganizationBrandingForm } from './organization-branding-form'
import { OrganizationFollowButton } from './organization-follow-button'
import { OrganizationPageMenu } from './organization-page-menu'
import { OrganizationPageTabs } from './organization-page-tabs'
import { OrganizationPostsSlot } from './organization-posts-slot'
import { OrganizationManageShell } from './organization-manage-shell'
import {
  brandingImagesProblem,
  companySizeLabel,
  organizationCoverUrl,
  organizationTabHref,
  organizationTagline,
  parseOrganizationPageTab,
} from '../organization-page-profile'

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('organization page helpers', () => {
  it('falls back to the first description line for the tagline and trims long lines', () => {
    expect(organizationTagline({ tagline: '  Saved  ', description: 'Other' })).toBe('Saved')
    expect(organizationTagline({ tagline: null, description: '\n  First line \nSecond' })).toBe('First line')
    expect(organizationTagline({ tagline: null, description: 'x'.repeat(200) })).toHaveLength(160)
    expect(organizationTagline({ tagline: null, description: null })).toBeNull()
  })

  it('parses tabs and builds shareable tab URLs', () => {
    expect(parseOrganizationPageTab('jobs')).toBe('jobs')
    expect(parseOrganizationPageTab(['people', 'jobs'])).toBe('people')
    expect(parseOrganizationPageTab('admin')).toBe('home')
    expect(organizationTabHref('oceanic', 'home')).toBe('/organizations/oceanic')
    expect(organizationTabHref('oceanic', 'about')).toBe('/organizations/oceanic?tab=about')
  })

  it('labels company sizes and versions cover URLs by stored key', () => {
    expect(companySizeLabel('1001-5000')).toBe('1,001–5,000 employees')
    expect(companySizeLabel(null)).toBeNull()
    expect(organizationCoverUrl({ id: 'c1', coverPath: null })).toBeNull()
    expect(organizationCoverUrl({ id: 'c1', coverPath: 'organizations/c1/cover-abc.jpg' })).toBe('/api/company-cover/c1?v=cover-abc.jpg')
  })

  it('checks chosen images before upload', () => {
    const mb = 1024 * 1024
    expect(brandingImagesProblem(null, { size: 2 * mb, type: 'image/png' })).toBeNull()
    expect(brandingImagesProblem({ size: 10, type: 'image/gif' }, null)).toBe('The logo must be a JPG, PNG or WebP image.')
    expect(brandingImagesProblem(null, { size: 6 * mb, type: 'image/jpeg' })).toBe('The cover image is larger than 5 MB. Choose a smaller image.')
    expect(brandingImagesProblem({ size: 3 * mb, type: 'image/png' }, { size: 3 * mb, type: 'image/jpeg' })).toMatch(/together are larger than 5.5 MB/)
  })
})

describe('OrganizationPageTabs', () => {
  const tabs = [
    { id: 'home', label: 'Home', href: '/organizations/oceanic' },
    { id: 'about', label: 'About', href: '/organizations/oceanic?tab=about' },
    { id: 'jobs', label: 'Jobs', href: '/organizations/oceanic?tab=jobs' },
  ]

  it('marks the current tab and moves focus with the arrow keys', () => {
    render(<OrganizationPageTabs tabs={tabs} active="about" label="Oceanic page sections" />)
    const about = screen.getByRole('link', { name: 'About' })
    expect(about).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    about.focus()
    fireEvent.keyDown(about, { key: 'ArrowRight' })
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(screen.getByRole('link', { name: 'Home' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveFocus()
  })
})

describe('OrganizationPageMenu', () => {
  it('copies the page link and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<OrganizationPageMenu organizationName="Oceanic" pagePath="/organizations/oceanic" />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Oceanic' }))
    expect(screen.queryByRole('menuitem', { name: /Request to join/ })).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' })) })
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/organizations/oceanic')
    expect(screen.getByRole('status')).toHaveTextContent('Link copied')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('explains when copying is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    render(<OrganizationPageMenu organizationName="Oceanic" pagePath="/organizations/oceanic" joinLink={{ href: '#work-here', label: 'Request to join' }} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for Oceanic' }), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toHaveFocus()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' })) })
    expect(screen.getByRole('status')).toHaveTextContent('Your browser blocked copying. Copy the link from the address bar instead.')
  })
})

describe('OrganizationFollowButton', () => {
  it('follows optimistically and rolls back with a message when saving fails', async () => {
    mocks.followOrganizationAction.mockResolvedValue({ ok: false, error: 'Your account cannot update organization follows right now.' })
    render(<OrganizationFollowButton companyId="c1" initialFollowing={false} initialFollowerCount={4} appearance="card" organizationName="Oceanic" />)
    fireEvent.click(screen.getByRole('button', { name: 'Follow Oceanic' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your account cannot update organization follows right now.'))
    expect(screen.getByRole('button', { name: 'Follow Oceanic' })).toHaveAttribute('aria-pressed', 'false')
    expect(mocks.followOrganizationAction).toHaveBeenCalledWith('c1')
  })

  it('keeps the original button with follower count by default', () => {
    render(<OrganizationFollowButton companyId="c1" initialFollowing initialFollowerCount={1} />)
    expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1 follower')).toBeInTheDocument()
  })
})

describe('OrganizationPostsSlot', () => {
  it('renders the organization posts feed, without the composer in the Home preview', () => {
    const { rerender } = render(<OrganizationPostsSlot companyId="c1" companySlug="oceanic" canPost limit={3} />)
    expect(screen.getByTestId('org-posts-tab')).toHaveAttribute('data-can-post', 'false')
    expect(screen.getByTestId('org-posts-tab')).toHaveAttribute('data-limit', '3')
    rerender(<OrganizationPostsSlot companyId="c1" companySlug="oceanic" canPost />)
    expect(screen.getByTestId('org-posts-tab')).toHaveAttribute('data-can-post', 'true')
    expect(screen.getByTestId('org-posts-tab')).toHaveAttribute('data-company', 'c1')
  })
})

describe('OrganizationManageShell', () => {
  it('links every section, marks the current one and flags locked ones', () => {
    render(
      <OrganizationManageShell workspace={{ id: 'c1', slug: 'oceanic', name: 'Oceanic', logoPath: null }} active="branding" summary="Owner · Free plan" showRequests pendingRequests={3} locked={{ team: true }}>
        <p>Body</p>
      </OrganizationManageShell>,
    )
    const nav = screen.getByRole('navigation', { name: 'Manage page sections' })
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/organizations/oceanic/manage',
      '/organizations/oceanic/manage?section=requests',
      '/organizations/oceanic/team',
      '/organizations/oceanic/branding',
      '/organizations/oceanic/analytics',
    ])
    expect(within(nav).getByRole('link', { name: /Branding/ })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Requests/ })).toHaveTextContent('3 waiting')
    expect(within(nav).getByLabelText('Needs Organization Pro or another role')).toBeInTheDocument()
    expect(screen.getByText('Owner · Free plan')).toBeInTheDocument()
  })
})

describe('OrganizationBrandingForm', () => {
  const workspace = {
    id: 'c1', slug: 'oceanic', name: 'Oceanic', logoPath: null, coverPath: 'organizations/c1/cover-a.jpg', tagline: 'Tanker management',
    companySize: '51-200' as const, specialties: ['LNG'], companyType: 'Ship manager', organizationType: 'ship_manager' as const, details: {},
    website: null, description: null, fleetSummary: null, vesselTypes: [], officeLocations: ['Mumbai'], verified: true,
  }

  it('shows the new page detail fields with current values and a live tagline counter', () => {
    render(<OrganizationBrandingForm workspace={workspace} />)
    const tagline = screen.getByRole('textbox', { name: /Tagline/ })
    expect(tagline).toHaveValue('Tanker management')
    expect(screen.getByText(/143 characters left/)).toBeInTheDocument()
    fireEvent.change(tagline, { target: { value: 'Crew care' } })
    expect(screen.getByText(/151 characters left/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Company size' })).toHaveValue('51-200')
    expect(screen.getByRole('textbox', { name: /Specialities/ })).toHaveValue('LNG')
    expect(screen.getByLabelText(/Cover image/)).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    expect(screen.getByRole('checkbox', { name: 'Remove the cover image' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save page details' })).toBeEnabled()
  })

  describe('cropping a picked image', () => {
    const original = new File([new Uint8Array(4096)], 'logo.png', { type: 'image/png' })
    const cropped = new File([new Uint8Array(1024)], 'logo.webp', { type: 'image/webp' })

    beforeEach(() => {
      vi.stubGlobal('URL', Object.assign(URL, {
        createObjectURL: vi.fn((file: File) => `blob:https://seanshore.example/${file.name}`),
        revokeObjectURL: vi.fn(),
      }))
    })
    afterEach(() => vi.unstubAllGlobals())

    it.each([
      ['Organization logo', 'Adjust your logo', '1'],
      ['Cover image', 'Adjust your cover photo', '4'],
    ])('opens the crop dialog when a %s is picked', (label, title, aspect) => {
      render(<OrganizationBrandingForm workspace={workspace} />)

      fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { files: [original] } })

      expect(screen.getByRole('dialog', { name: title })).toHaveAttribute('aria-modal', 'true')
      expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-shape', 'rect')
      expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-aspect', aspect)
    })

    it('puts the cropped logo into the file input and previews it after Save', async () => {
      mocks.cropImageToFile.mockResolvedValueOnce(cropped)
      class FakeDataTransfer {
        private list: File[] = []
        items = { add: (file: File) => { this.list.push(file) } }
        get files() { return this.list }
      }
      vi.stubGlobal('DataTransfer', FakeDataTransfer)
      render(<OrganizationBrandingForm workspace={workspace} />)
      const input = screen.getByLabelText(/Organization logo/) as HTMLInputElement
      // jsdom only accepts a real FileList here; let the test observe the assignment instead.
      Object.defineProperty(input, 'files', { configurable: true, writable: true, value: null })

      fireEvent.change(input, { target: { files: [original] } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(mocks.cropImageToFile).toHaveBeenCalledWith(original, { x: 0, y: 0, width: 600, height: 600 }, { maxEdge: 2048 })
      expect(input.files?.[0]).toBe(cropped)
      const preview = document.querySelector('img[src="blob:https://seanshore.example/logo.webp"]')
      expect(preview).not.toBeNull()
    })

    it('keeps the original selected, and previews it, where the browser cannot rebuild the file list', async () => {
      mocks.cropImageToFile.mockResolvedValueOnce(cropped)
      render(<OrganizationBrandingForm workspace={workspace} />)
      const input = screen.getByLabelText(/Cover image/) as HTMLInputElement

      fireEvent.change(input, { target: { files: [original] } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(input.files?.[0]).toBe(original)
      expect(document.querySelector('img[src="blob:https://seanshore.example/logo.png"]')).not.toBeNull()
    })

    it('clears the picker and shows no preview when the crop is cancelled', () => {
      render(<OrganizationBrandingForm workspace={workspace} />)
      const input = screen.getByLabelText(/Organization logo/) as HTMLInputElement

      fireEvent.change(input, { target: { files: [original] } })
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(input.value).toBe('')
      expect(document.querySelector('img[src^="blob:"]')).toBeNull()
      expect(mocks.cropImageToFile).not.toHaveBeenCalled()
    })
  })
})
