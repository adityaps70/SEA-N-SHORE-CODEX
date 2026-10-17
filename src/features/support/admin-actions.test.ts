import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  allowed: true,
  repository: { replyAsAdmin: vi.fn(), setStatusAsAdmin: vi.fn() },
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/admin/access', () => ({
  requirePlatformAdministratorUser: vi.fn(async () => {
    if (!mocks.allowed) throw new Error('admin_forbidden')
    return { id: '44444444-4444-4444-8444-444444444444', cognitoSub: 'sub', email: null }
  }),
}))
vi.mock('./repository', () => ({ supportRepository: mocks.repository }))

import { closeTicketAsAdmin, reopenTicketAsAdmin, replyToTicketAsAdmin } from './admin-actions'

const TICKET = '33333333-3333-4333-8333-333333333333'
const ADMIN = '44444444-4444-4444-8444-444444444444'

function form(body: string) {
  const data = new FormData()
  data.append('body', body)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.allowed = true
  mocks.repository.replyAsAdmin.mockResolvedValue({ ok: true })
  mocks.repository.setStatusAsAdmin.mockImplementation(async (_admin: string, _ticket: string, next: string) => ({ ok: true, status: next }))
})

describe('Admin › Support actions (round H, H7)', () => {
  it('refuses anyone who is not an administrator with admin MFA', async () => {
    mocks.allowed = false
    expect((await replyToTicketAsAdmin(TICKET, { status: 'idle' }, form('Hello'))).status).toBe('error')
    expect(await closeTicketAsAdmin(TICKET)).toMatchObject({ ok: false })
    expect(await reopenTicketAsAdmin(TICKET)).toMatchObject({ ok: false })
    expect(mocks.repository.replyAsAdmin).not.toHaveBeenCalled()
    expect(mocks.repository.setStatusAsAdmin).not.toHaveBeenCalled()
  })

  it('replies as the administrator and refreshes both sides', async () => {
    expect(await replyToTicketAsAdmin(TICKET, { status: 'idle' }, form('  Placeholder answer.  '))).toMatchObject({ status: 'success' })
    expect(mocks.repository.replyAsAdmin).toHaveBeenCalledWith(ADMIN, TICKET, 'Placeholder answer.')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/support/${TICKET}`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/help/requests/${TICKET}`)
  })

  it('needs a reply, and explains a closed request', async () => {
    expect(await replyToTicketAsAdmin(TICKET, { status: 'idle' }, form(''))).toMatchObject({ status: 'error', fieldError: 'Write your reply.' })
    mocks.repository.replyAsAdmin.mockResolvedValueOnce({ ok: false, reason: 'closed' })
    expect((await replyToTicketAsAdmin(TICKET, { status: 'idle' }, form('Hello'))).message).toBe('This request is closed. Reopen it to reply.')
  })

  it('closes and reopens', async () => {
    expect(await closeTicketAsAdmin(TICKET)).toEqual({ ok: true })
    expect(mocks.repository.setStatusAsAdmin).toHaveBeenLastCalledWith(ADMIN, TICKET, 'closed')
    expect(await reopenTicketAsAdmin(TICKET)).toEqual({ ok: true })
    expect(mocks.repository.setStatusAsAdmin).toHaveBeenLastCalledWith(ADMIN, TICKET, 'open')
    mocks.repository.setStatusAsAdmin.mockResolvedValueOnce({ ok: false, reason: 'unchanged' })
    expect(await closeTicketAsAdmin(TICKET)).toEqual({ ok: false, error: 'This request was already changed. Refresh the page.' })
  })
})
