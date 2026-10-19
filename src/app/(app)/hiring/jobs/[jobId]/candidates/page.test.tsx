import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  isRankingEnabled: vi.fn(),
  listManagedJobs: vi.fn(),
  getPublishedJob: vi.fn(),
  list: vi.fn(),
  isVerifiedRecruiter: vi.fn(),
  startDirectConversationAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/hiring/jobs/job-1/candidates' }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/ranking/switches', () => ({ isRankingEnabled: mocks.isRankingEnabled }))
vi.mock('@/features/jobs/hiring-repository', () => ({ hiringRepository: { listManagedJobs: mocks.listManagedJobs } }))
vi.mock('@/features/jobs/repository', () => ({ jobsRepository: { getPublishedJob: mocks.getPublishedJob } }))
vi.mock('@/features/ranking/job-candidates', () => ({ jobCandidateSuggestions: { list: mocks.list } }))
vi.mock('@/features/jobs/applicant-media', () => ({ applicantPhotoUrl: vi.fn(async () => null) }))
vi.mock('@/features/messaging/recruiter-contact-queries', () => ({ isVerifiedRecruiter: mocks.isVerifiedRecruiter }))
vi.mock('@/features/messaging/actions', () => ({ startDirectConversationAction: mocks.startDirectConversationAction }))
vi.mock('@/features/network/components/connection-primary-action', () => ({
  ConnectionPrimaryAction: ({ fullName }: { fullName: string }) => <button type="button">Connect with {fullName}</button>,
}))

import SuggestedCandidatesPage from './page'

const none = { following: false, connection: { kind: 'none', connectionId: null } }
const connected = { following: false, connection: { kind: 'connected', connectionId: 'c-1' } }
function candidate(id: string, fullName: string, overrides: Record<string, unknown> = {}) {
  return {
    id, slug: null, fullName, avatarPath: null, headline: null, location: null, relationship: none, messagePermission: 'connections',
    match: { eligible: true, score: 80, reasons: [], missingRequirements: [], warnings: [] }, ...overrides,
  }
}

async function renderPage() {
  render(await SuggestedCandidatesPage({ params: Promise.resolve({ jobId: 'job-1' }) }))
}

afterEach(() => cleanup())

// Recruiter messaging exception (Oct 2026) on Suggested candidates (members open to recruiters).
describe('suggested candidates: messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'recruiter-1' })
    mocks.isRankingEnabled.mockResolvedValue(true)
    mocks.listManagedJobs.mockResolvedValue([{ id: 'job-1', title: 'Placeholder Chief Officer' }])
    mocks.getPublishedJob.mockResolvedValue({ id: 'job-1' })
    mocks.startDirectConversationAction.mockResolvedValue({ ok: true, conversationId: 'conversation-1' })
    mocks.list.mockResolvedValue([
      candidate('m-open', 'Placeholder Open'),
      candidate('m-nobody', 'Placeholder Nobody', { messagePermission: 'nobody' }),
      candidate('m-connected', 'Placeholder Connected', { relationship: connected }),
    ])
  })

  it('lets a verified recruiter message an unconnected member, as "open to recruiters", but never one who chose Nobody', async () => {
    mocks.isVerifiedRecruiter.mockResolvedValue(true)
    await renderPage()
    expect(screen.getByText(/As a verified recruiter you can message them directly, up to 20 new conversations a day/)).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem').filter((row) => row.querySelector('h2'))
    const open = rows.find((row) => row.textContent?.includes('Placeholder Open'))!
    within(open).getByRole('button', { name: 'Message Placeholder Open' }).click()
    await vi.waitFor(() => expect(mocks.startDirectConversationAction).toHaveBeenCalledWith('m-open', { reason: 'open_to_recruiters' }))
    const nobody = rows.find((row) => row.textContent?.includes('Placeholder Nobody'))!
    expect(within(nobody).queryByRole('button', { name: /^Message/ })).not.toBeInTheDocument()
    // A connection's Message comes from the connection action, not a second button.
    const conn = rows.find((row) => row.textContent?.includes('Placeholder Connected'))!
    expect(within(conn).queryByRole('button', { name: /^Message/ })).not.toBeInTheDocument()
  })

  it('gives an unverified recruiter no Message button for "connections only" members', async () => {
    mocks.isVerifiedRecruiter.mockResolvedValue(false)
    await renderPage()
    expect(screen.getByText(/Reach them by connecting or, once connected, by message/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Message/ })).not.toBeInTheDocument()
  })
})
