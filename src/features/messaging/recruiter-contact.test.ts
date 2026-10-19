import { describe, expect, it, vi } from 'vitest'
import { RECRUITER_CONVERSATIONS_PER_DAY, recruiterContactLine } from './recruiter-contact'

const repo = vi.hoisted(() => ({ findByConversation: vi.fn() }))
vi.mock('./recruiter-contact-repository', () => ({ createRecruiterContactRepository: () => repo }))
vi.mock('@/features/network/repository', () => ({ createNetworkRepository: () => ({}) }))
vi.mock('./repository', () => ({ createMessagingRepository: () => ({}) }))

const { getRecruiterContact, recruiterMessageAccess } = await import('./recruiter-contact-queries')

const RECRUITER = 'recruiter-1'
const MEMBER = 'member-1'
const APPLICATION = 'application-1'

function deps(input: { blocked?: boolean; connected?: boolean; permission?: string; verified?: boolean; applied?: boolean; open?: boolean } = {}) {
  return {
    network: {
      isPairBlocked: vi.fn(async () => input.blocked ?? false),
      findConnectionByPair: vi.fn(async () => (input.connected ? { status: 'accepted' } : null)),
    },
    messaging: { getMessagePermission: vi.fn(async () => input.permission ?? 'connections') },
    recruiters: {
      isVerifiedRecruiter: vi.fn(async () => input.verified ?? false),
      findApplicationForRecruiter: vi.fn(async () => (input.applied ? { application_id: APPLICATION, job_id: 'job-1', job_title: 'Placeholder' } : null)),
      isOpenToRecruiters: vi.fn(async () => input.open ?? false),
    },
  } as never
}

describe('recruiter reason line', () => {
  it('names the job, falls back when it is gone, and says "open to recruiters" otherwise', () => {
    expect(recruiterContactLine({ reason: 'applied', jobTitle: 'Placeholder Chief Officer', viewer: 'member' })).toBe('Sent because you applied to Placeholder Chief Officer')
    expect(recruiterContactLine({ reason: 'applied', jobTitle: null, viewer: 'member' })).toBe('Sent because you applied to one of their jobs')
    expect(recruiterContactLine({ reason: 'open_to_recruiters', jobTitle: null, viewer: 'member' })).toBe('Sent because you’re open to recruiters')
    expect(RECRUITER_CONVERSATIONS_PER_DAY).toBe(20)
  })

  it('getRecruiterContact words the line for whoever is viewing the conversation', async () => {
    repo.findByConversation.mockResolvedValue({ recruiter_profile_id: RECRUITER, member_profile_id: MEMBER, reason: 'applied', job_title: 'Placeholder Chief Officer' })
    await expect(getRecruiterContact('conversation-1', MEMBER)).resolves.toEqual({ recruiterProfileId: RECRUITER, line: 'Sent because you applied to Placeholder Chief Officer' })
    await expect(getRecruiterContact('conversation-1', RECRUITER)).resolves.toEqual({ recruiterProfileId: RECRUITER, line: 'Sent because they applied to Placeholder Chief Officer' })
    repo.findByConversation.mockResolvedValue(null)
    await expect(getRecruiterContact('conversation-2', MEMBER)).resolves.toBeNull()
  })

  it('is worded for the recruiter when the recruiter reads the thread', () => {
    expect(recruiterContactLine({ reason: 'applied', jobTitle: 'Placeholder Chief Officer', viewer: 'recruiter' })).toBe('Sent because they applied to Placeholder Chief Officer')
    expect(recruiterContactLine({ reason: 'applied', jobTitle: '  ', viewer: 'recruiter' })).toBe('Sent because they applied to one of your jobs')
    expect(recruiterContactLine({ reason: 'open_to_recruiters', jobTitle: null, viewer: 'recruiter' })).toBe('Sent because they’re open to recruiters')
  })
})

describe('recruiter message access (what the recruiter screens offer)', () => {
  const applied = { recruiterId: RECRUITER, memberId: MEMBER, applicationId: APPLICATION }
  const suggested = { recruiterId: RECRUITER, memberId: MEMBER }

  it('verified recruiter: about an application to their job, or a member open to recruiters', async () => {
    await expect(recruiterMessageAccess(applied, deps({ verified: true, applied: true }))).resolves.toEqual({ canMessage: true, contact: { reason: 'applied', applicationId: APPLICATION } })
    await expect(recruiterMessageAccess(suggested, deps({ verified: true, open: true }))).resolves.toEqual({ canMessage: true, contact: { reason: 'open_to_recruiters' } })
  })

  it('unverified recruiter, or no application / not open: the member\'s setting decides', async () => {
    await expect(recruiterMessageAccess(applied, deps({ verified: false, applied: true }))).resolves.toEqual({ canMessage: false, contact: null })
    await expect(recruiterMessageAccess(applied, deps({ verified: true, applied: false }))).resolves.toEqual({ canMessage: false, contact: null })
    await expect(recruiterMessageAccess(suggested, deps({ verified: true, open: false }))).resolves.toEqual({ canMessage: false, contact: null })
    await expect(recruiterMessageAccess(suggested, deps({ connected: true }))).resolves.toEqual({ canMessage: true, contact: null })
    await expect(recruiterMessageAccess(suggested, deps({ permission: 'everyone' }))).resolves.toEqual({ canMessage: true, contact: null })
  })

  it('a block or "Nobody" always refuses', async () => {
    await expect(recruiterMessageAccess(applied, deps({ blocked: true, verified: true, applied: true, connected: true }))).resolves.toEqual({ canMessage: false, contact: null })
    await expect(recruiterMessageAccess(applied, deps({ permission: 'nobody', verified: true, applied: true, connected: true }))).resolves.toEqual({ canMessage: false, contact: null })
  })
})
