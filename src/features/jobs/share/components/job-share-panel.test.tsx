import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadJobSharePanel: vi.fn(),
  recordJobImageShare: vi.fn(),
  shareJobToFeed: vi.fn(),
}))

vi.mock('../share-actions', () => mocks)

import { defaultShareOptions } from '../share-options'
import { JobShareButton } from './job-share-button'

const jobId = '7d3f1c2a-1111-4222-8333-444455556666'
const applyUrl = `https://seanshore.in/jobs/${jobId}?src=share_image`

function panelState(overrides: Record<string, unknown> = {}) {
  return {
    jobId,
    title: 'Chief Officer',
    defaults: defaultShareOptions({ urgent: false }),
    availableFacts: ['joining', 'experience'],
    hasSalary: true,
    caption: '',
    captionJob: {
      id: jobId, title: 'Chief Officer', companyName: 'Placeholder Shipping', location: 'Mumbai, India', rank: 'Chief Officer', domain: 'sea' as const,
      vesselTypes: ['Product tanker'], salaryMin: 9000, salaryMax: 11000, salaryCurrency: 'USD', salaryPeriod: 'month' as const,
    },
    applyUrl,
    canPostToFeed: true,
    postAs: 'Placeholder Shipping',
    lastFeedShareAt: null,
    nextFeedShareAt: null,
    counts: { images: 3, feedPosts: 1, appliesFromImage: 2, appliesFromFeed: 1 },
    ...overrides,
  }
}

async function openPanel(state = panelState()) {
  mocks.loadJobSharePanel.mockResolvedValue({ ok: true, state })
  render(<JobShareButton jobId={jobId} />)
  fireEvent.click(screen.getByRole('button', { name: 'Share job' }))
  return screen.findByRole('dialog', { name: 'Share job' })
}

afterEach(() => cleanup())

describe('job share panel (Round I, I1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.recordJobImageShare.mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ fits: true, truncated: false }), { status: 200 })))
  })

  it('opens with the two tabs, a live preview of the real image and the "fits" check', async () => {
    const dialog = await openPanel()
    const tabs = within(dialog).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Download image', 'Post to feed'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    const preview = await within(dialog).findByTestId('job-share-preview')
    expect(preview.getAttribute('src')).toBe(`/api/jobs/${jobId}/share-image?size=portrait&look=navy&opts=label%3Anow_hiring%3Bbadge%3Acoral%3Bsalary%3Aon%3Bqr%3Aon%3Bfacts%3Ajoining%2Bexperience`)
    expect(await within(dialog).findByText('Fits: all text is inside the image')).toBeInTheDocument()
  })

  it('changes the preview with the size, look, badge and toggles, and shows only the facts the job has', async () => {
    const dialog = await openPanel()
    fireEvent.click(within(dialog).getByRole('radio', { name: /Story/ }))
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Minimal white' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Emerald' }))
    fireEvent.change(within(dialog).getByLabelText('Badge'), { target: { value: 'multiple_openings' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Salary' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Experience' }))
    const src = within(dialog).getByTestId('job-share-preview').getAttribute('src')!
    const params = new URL(src, 'https://seanshore.in').searchParams
    expect(params.get('size')).toBe('story')
    expect(params.get('look')).toBe('white')
    expect(params.get('opts')).toBe('label:multiple_openings;badge:emerald;salary:off;qr:on;facts:joining')
    expect(within(dialog).queryByRole('checkbox', { name: 'Vessel type' })).toBeNull()
    expect(within(dialog).queryByRole('checkbox', { name: 'Apply by' })).toBeNull()
  })

  it('hides the salary toggle for a job without salary', async () => {
    const dialog = await openPanel(panelState({ hasSalary: false }))
    expect(within(dialog).queryByRole('checkbox', { name: 'Salary' })).toBeNull()
    expect(within(dialog).getByText('Details the job does not have are never shown.')).toBeInTheDocument()
  })

  it('writes the caption from the job (no emojis) and follows the badge and salary until it is edited', async () => {
    const dialog = await openPanel()
    const caption = within(dialog).getByLabelText('Caption', { selector: '[id$="-image"]' }) as HTMLTextAreaElement
    expect(caption.value).toContain('Now hiring: Chief Officer')
    expect(caption.value).toContain('Placeholder Shipping · Mumbai, India')
    expect(caption.value).toContain('Salary: $9,000–11,000/month')
    expect(caption.value).toContain(applyUrl)
    expect(caption.value.match(/#\w+/g)!.length).toBeGreaterThanOrEqual(3)
    expect(caption.value.match(/#\w+/g)!.length).toBeLessThanOrEqual(5)
    expect(caption.value).not.toMatch(/\p{Extended_Pictographic}/u)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Salary' }))
    expect(caption.value).not.toContain('Salary:')
    fireEvent.change(caption, { target: { value: 'My own words' } })
    fireEvent.change(within(dialog).getByLabelText('Badge'), { target: { value: 'urgent_hiring' } })
    expect(caption.value).toBe('My own words')
  })

  it('links Download PNG to the file and counts the share', async () => {
    const dialog = await openPanel()
    const download = within(dialog).getByRole('link', { name: 'Download PNG' })
    expect(download.getAttribute('href')).toContain('download=1')
    expect(download).toHaveAttribute('download', 'sea-n-shore-job-portrait.png')
    download.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(download)
    expect(mocks.recordJobImageShare).toHaveBeenCalledWith(jobId)
  })

  it('moves between the tabs with the arrow keys', async () => {
    const dialog = await openPanel()
    const [imageTab, feedTab] = within(dialog).getAllByRole('tab')
    fireEvent.keyDown(imageTab!, { key: 'ArrowRight' })
    expect(feedTab).toHaveAttribute('aria-selected', 'true')
    expect(feedTab).toHaveFocus()
    expect(within(dialog).getByRole('tabpanel', { name: 'Post to feed' })).toBeVisible()
  })

  it('posts to the feed as the organization, then shows the date and when it can be shared again', async () => {
    mocks.shareJobToFeed.mockResolvedValue({ ok: true, postId: '99999999-1111-4111-8111-111111111111' })
    const dialog = await openPanel()
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Post to feed' }))
    const feed = within(dialog).getByRole('tabpanel', { name: 'Post to feed' })
    expect(within(feed).getByText('Placeholder Shipping')).toBeInTheDocument()
    expect(within(feed).getByText('Anyone')).toBeInTheDocument()
    fireEvent.click(within(feed).getByRole('button', { name: 'Post to feed' }))
    await waitFor(() => expect(within(feed).getByText(/Posted to the feed/)).toBeInTheDocument())
    expect(mocks.shareJobToFeed).toHaveBeenCalledWith(expect.objectContaining({ jobId, size: 'portrait', look: 'navy', caption: expect.stringContaining('Chief Officer') }))
    expect(within(feed).getByRole('link', { name: 'View post' })).toHaveAttribute('href', '/posts/99999999-1111-4111-8111-111111111111')
    expect(within(feed).getByTestId('job-share-feed-status').textContent).toMatch(/^Shared to feed on .+\. You can share it again on .+\.$/)
    await waitFor(() => expect(within(feed).getByRole('button', { name: 'Post to feed' })).toBeDisabled())
  })

  it('shows the last feed share and keeps Post to feed off for 7 days', async () => {
    const dialog = await openPanel(panelState({ lastFeedShareAt: '2026-10-18T06:00:00.000Z', nextFeedShareAt: '2026-10-25T06:00:00.000Z' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Post to feed' }))
    expect(within(dialog).getByTestId('job-share-feed-status').textContent).toBe('Shared to feed on Oct 18, 2026. You can share it again on Oct 25, 2026.')
    expect(within(dialog).getByRole('button', { name: 'Post to feed' })).toBeDisabled()
  })

  it('explains when the viewer can make the image but not post it (an admin on a personal job)', async () => {
    const dialog = await openPanel(panelState({ canPostToFeed: false, postAs: 'you' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Post to feed' }))
    expect(within(dialog).getByText(/Only the person who posted this job can share it to the feed/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Post to feed' })).toBeNull()
  })

  it('shows the share counts, including applies from shares', async () => {
    const dialog = await openPanel()
    expect(within(dialog).getByTestId('job-share-counts').textContent).toBe('3 image shares · 1 feed post · Applies from shares: 2 from the image, 1 from the feed')
  })

  it('shows the server’s refusal instead of the panel', async () => {
    mocks.loadJobSharePanel.mockResolvedValue({ ok: false, error: 'This job is closed, so it can no longer be shared.' })
    render(<JobShareButton jobId={jobId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share job' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This job is closed, so it can no longer be shared.')
  })
})
