import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MentorApplicationInput } from './mentor-application'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  submitMentorApplication: vi.fn(),
  resubmitMentorApplication: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./repository')>()
  return {
    ...original,
    learningRepository: {
      submitMentorApplication: mocks.submitMentorApplication,
      resubmitMentorApplication: mocks.resubmitMentorApplication,
    },
  }
})

import { resubmitMentorApplication, submitMentorApplication } from './actions'

const applicationId = '11111111-1111-4111-8111-111111111111'

function validInput(overrides: Partial<MentorApplicationInput> = {}): MentorApplicationInput {
  return {
    name: ' Capt. Maya Singh ',
    currentLastRank: ' Master Mariner ',
    yearsExperience: 18,
    vesselTypes: [' Oil Tanker ', 'oil tanker', 'Chemical Tanker'],
    specialization: ' SIRE 2.0, tanker operations and bridge leadership ',
    certifications: [' Master Unlimited ', 'ISO 9001 Lead Auditor'],
    linkedInUrl: ' https://www.linkedin.com/in/maya-singh-mariner ',
    shortBio: ' Master Mariner with eighteen years of sea and shore experience focused on tanker safety, leadership and practical competency development. ',
    profilePhotoPath: null,
    proposedCourseTopics: [' SIRE 2.0 readiness ', 'Bridge leadership'],
    ...overrides,
  }
}

describe('learning mentor application server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'captain@example.com' })
    mocks.submitMentorApplication.mockResolvedValue({ applicationId })
    mocks.resubmitMentorApplication.mockResolvedValue(true)
  })

  it('validates before authentication or repository mutation', async () => {
    const result = await submitMentorApplication(validInput({ linkedInUrl: 'http://linkedin.com/in/not-secure' }))

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.submitMentorApplication).not.toHaveBeenCalled()
  })

  it('submits normalized mentor data with the authenticated Sea N Shore user', async () => {
    await expect(submitMentorApplication(validInput())).resolves.toEqual({ ok: true, applicationId })

    expect(mocks.submitMentorApplication).toHaveBeenCalledWith('user-1', {
      name: 'Capt. Maya Singh',
      currentLastRank: 'Master Mariner',
      yearsExperience: 18,
      vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
      specialization: 'SIRE 2.0, tanker operations and bridge leadership',
      certifications: ['Master Unlimited', 'ISO 9001 Lead Auditor'],
      linkedInUrl: 'https://www.linkedin.com/in/maya-singh-mariner',
      shortBio: 'Master Mariner with eighteen years of sea and shore experience focused on tanker safety, leadership and practical competency development.',
      profilePhotoPath: null,
      proposedCourseTopics: ['SIRE 2.0 readiness', 'Bridge leadership'],
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/teach')
  })

  it('rejects an invalid application id before authentication on resubmission', async () => {
    const result = await resubmitMentorApplication('not-a-uuid', validInput())

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.resubmitMentorApplication).not.toHaveBeenCalled()
  })

  it('resubmits with authenticated identity and refreshes learning state', async () => {
    await expect(resubmitMentorApplication(applicationId, validInput())).resolves.toEqual({ ok: true })

    expect(mocks.resubmitMentorApplication).toHaveBeenCalledWith('user-1', applicationId, expect.objectContaining({
      name: 'Capt. Maya Singh',
      vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
    }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/teach')
  })

  it('returns safe copy when a mentor application already exists', async () => {
    mocks.submitMentorApplication.mockRejectedValueOnce(new Error('mentor_application_already_exists'))

    await expect(submitMentorApplication(validInput())).resolves.toEqual({
      ok: false,
      error: 'You already have a mentor application. Open Teach on Sea N Shore to view its status.',
    })
  })
})
