import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  canUsePlatformAdminAuthority: vi.fn(),
  listQuestions: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/admin/mfa-gate', () => ({ canUsePlatformAdminAuthority: mocks.canUsePlatformAdminAuthority }))
vi.mock('@/features/learning/question-bank-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/learning/question-bank-repository')>()),
  questionBankRepository: { listQuestions: mocks.listQuestions },
}))

import { QuestionBankError } from '@/features/learning/question-bank-repository'
import { questionsToCsv } from '@/features/learning/quiz-csv'
import { GET } from './route'

const trainerId = '66666666-6666-4666-8666-666666666666'

function get(query = '', headers: Record<string, string> = {}) {
  return GET(new Request(`https://seanshore.example/api/learn/question-bank/export${query}`, { headers }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.getVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'fixture@example.test' })
  mocks.canUsePlatformAdminAuthority.mockResolvedValue(false)
  mocks.listQuestions.mockResolvedValue([])
})

describe('GET /api/learn/question-bank/export', () => {
  it('answers a router prefetch or a browser speculative prefetch with an empty 204 and touches no bank (owner 21 Nov)', async () => {
    for (const headers of [{ rsc: '1' }, { 'next-router-prefetch': '1' }, { 'sec-purpose': 'prefetch' }, { purpose: 'prefetch' }] as Record<string, string>[]) {
      const response = await get(`?trainer=${trainerId}`, headers)
      expect(response.status).toBe(204)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.text()).toBe('')
    }
    expect(mocks.getVerifiedUser).not.toHaveBeenCalled()
    expect(mocks.canUsePlatformAdminAuthority).not.toHaveBeenCalled()
    expect(mocks.listQuestions).not.toHaveBeenCalled()
  })

  it("downloads the trainer's own question bank as a private CSV attachment", async () => {
    const response = await get()

    expect(response.status).toBe(200)
    expect(mocks.listQuestions).toHaveBeenCalledWith({ actorId: 'user-1', asAdminForMentorId: null })
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="sea-n-shore-question-bank-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new TextEncoder().encode(questionsToCsv([])))
  })

  it('asks signed-out visitors to sign in before reading anything', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    const response = await get()
    expect(response.status).toBe(401)
    expect(mocks.listQuestions).not.toHaveBeenCalled()
  })

  it("exports another trainer's bank only for a platform administrator", async () => {
    expect((await get(`?trainer=${trainerId}`)).status).toBe(404)
    expect((await get('?trainer=not-a-uuid')).status).toBe(404)
    expect(mocks.listQuestions).not.toHaveBeenCalled()

    mocks.canUsePlatformAdminAuthority.mockResolvedValue(true)
    expect((await get(`?trainer=${trainerId}`)).status).toBe(200)
    expect(mocks.listQuestions).toHaveBeenCalledWith({ actorId: 'user-1', asAdminForMentorId: trainerId })
  })

  it('refuses someone who is not a verified trainer', async () => {
    mocks.listQuestions.mockRejectedValue(new QuestionBankError('question_bank_forbidden'))
    const response = await get()
    expect(response.status).toBe(403)
    expect(console.error).not.toHaveBeenCalled()
  })
})
