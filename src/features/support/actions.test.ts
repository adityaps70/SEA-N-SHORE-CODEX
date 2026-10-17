import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  viewer: null as null | { profileId: string; name: string; email: string },
  user: { id: '22222222-2222-4222-8222-222222222222', cognitoSub: 'sub', email: 'member@example.com' } as { id: string; cognitoSub: string; email: string } | null,
  repository: {
    createTicket: vi.fn(),
    replyAsMember: vi.fn(),
  },
  revalidatePath: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/features/newsletter/config', () => ({ getNewsletterConfig: () => ({ tokenSecret: 'placeholder-secret-placeholder-secret-0001' }) }))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: vi.fn(async () => {
    if (!mocks.user) throw new Error('Authentication required.')
    return mocks.user
  }),
}))
vi.mock('./viewer', () => ({ getSupportViewer: async () => mocks.viewer }))
vi.mock('./repository', () => ({ supportRepository: mocks.repository }))

import { replyToMyTicket, submitContactForm } from './actions'

const TICKET = '33333333-3333-4333-8333-333333333333'

function form(entries: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

const valid = { name: 'Placeholder Sender', email: 'Sender@Example.com', topic: 'account', message: 'I lost my authenticator app and cannot sign in.', website: '' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.viewer = null
  mocks.user = { id: '22222222-2222-4222-8222-222222222222', cognitoSub: 'sub', email: 'member@example.com' }
  mocks.repository.createTicket.mockResolvedValue({ ok: true, ticketId: TICKET })
  mocks.repository.replyAsMember.mockResolvedValue({ ok: true })
})

describe('submitContactForm (round H, H7)', () => {
  it('returns a plain error per field and keeps what was typed', async () => {
    const result = await submitContactForm({ status: 'idle' }, form({ name: '', email: 'nope', topic: '', message: 'short' }))
    expect(result.status).toBe('error')
    expect(result.fieldErrors).toEqual({
      name: 'Enter your name.',
      email: 'Enter a valid email address, like name@example.com.',
      topic: 'Choose what your message is about.',
      message: 'Write a little more, at least 10 characters, so we can help.',
    })
    expect(result.values).toMatchObject({ email: 'nope', message: 'short' })
    expect(mocks.repository.createTicket).not.toHaveBeenCalled()
  })

  it('accepts a filled honeypot quietly and saves nothing', async () => {
    const result = await submitContactForm({ status: 'idle' }, form({ ...valid, website: 'https://spam.example' }))
    expect(result.status).toBe('success')
    expect(mocks.repository.createTicket).not.toHaveBeenCalled()
  })

  it('saves a visitor ticket with a hashed IP and no profile', async () => {
    const result = await submitContactForm({ status: 'idle' }, form(valid))
    expect(result).toMatchObject({ status: 'success', reference: 'SNS-33333333' })
    expect(result.ticketId).toBeUndefined()
    expect(result.message).toContain('We will reply to sender@example.com')
    const input = mocks.repository.createTicket.mock.calls[0]![0]
    expect(input).toMatchObject({ senderProfileId: null, senderName: 'Placeholder Sender', senderEmail: 'sender@example.com', topic: 'account' })
    expect(input.ipHash).toMatch(/^[0-9a-f]{32}$/)
  })

  it('links a signed-in member’s ticket to their profile and points them to My requests', async () => {
    mocks.viewer = { profileId: '22222222-2222-4222-8222-222222222222', name: 'Placeholder Sender', email: 'sender@example.com' }
    const result = await submitContactForm({ status: 'idle' }, form(valid))
    expect(result).toMatchObject({ status: 'success', ticketId: TICKET })
    expect(result.message).toContain('Help › My requests')
    expect(mocks.repository.createTicket.mock.calls[0]![0].senderProfileId).toBe('22222222-2222-4222-8222-222222222222')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/help/requests')
  })

  it('explains the rate limit and a failure without losing the message', async () => {
    mocks.repository.createTicket.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' })
    const limited = await submitContactForm({ status: 'idle' }, form(valid))
    expect(limited).toMatchObject({ status: 'error', values: { message: valid.message } })
    expect(limited.message).toContain('wait an hour')

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.repository.createTicket.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '57P01' }))
    const failed = await submitContactForm({ status: 'idle' }, form(valid))
    expect(failed).toMatchObject({ status: 'error', values: { message: valid.message } })
    expect(JSON.stringify(error.mock.calls)).not.toContain('sender@example.com')
    expect(JSON.stringify(error.mock.calls)).not.toContain('Placeholder Sender')
    error.mockRestore()
  })
})

describe('replyToMyTicket (round H, H7)', () => {
  it('needs a reply and a signed-in member', async () => {
    expect(await replyToMyTicket(TICKET, { status: 'idle' }, form({ body: '  ' }))).toMatchObject({ status: 'error', fieldError: 'Write your reply.' })
    mocks.user = null
    expect((await replyToMyTicket(TICKET, { status: 'idle' }, form({ body: 'Hello' }))).message).toContain('Sign in again')
    expect(mocks.repository.replyAsMember).not.toHaveBeenCalled()
  })

  it('sends the reply as the member, and explains a closed ticket', async () => {
    expect(await replyToMyTicket(TICKET, { status: 'idle' }, form({ body: 'Placeholder follow-up' }))).toMatchObject({ status: 'success' })
    expect(mocks.repository.replyAsMember).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', TICKET, 'Placeholder follow-up')
    mocks.repository.replyAsMember.mockResolvedValueOnce({ ok: false, reason: 'closed' })
    const closed = await replyToMyTicket(TICKET, { status: 'idle' }, form({ body: 'Placeholder follow-up' }))
    expect(closed).toMatchObject({ status: 'error', body: 'Placeholder follow-up' })
    expect(closed.message).toContain('closed')
  })
})
