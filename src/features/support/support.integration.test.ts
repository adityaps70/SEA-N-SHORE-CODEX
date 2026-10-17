import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createSupportRepository, SUPPORT_TICKET_LIMITS } from './repository'
import { createSupportEmailRepository, createSupportEmailSweep, createSupportEmailWorker } from './support-email-sending'
import { SUPPORT_OPERATIONS_EMAIL } from './topics'

/**
 * Round H (H7) against the real schema (PGlite, every migration including 0089): Contact page tickets,
 * the member's own list and replies, admin answers and close / reopen, the rate limits, and the queued
 * emails the outbox worker sends. Placeholder names and example.com addresses only.
 */
let db: TestDatabase
let sequence = 0

const query = (text: string, values?: readonly unknown[]) => db.query(text, values)
const transaction = <T,>(work: (run: typeof query) => Promise<T>) => db.transaction((tx) => work(tx))

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function profile(name: string) {
  sequence += 1
  const rows = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [`${name} ${sequence}`])
  return String(rows[0]!.id)
}

function repository() {
  return createSupportRepository({ query, transaction })
}

function ticketInput(overrides: Partial<Parameters<ReturnType<typeof createSupportRepository>['createTicket']>[0]> = {}) {
  sequence += 1
  return {
    senderProfileId: null,
    senderName: 'Placeholder Sender',
    senderEmail: `sender-${sequence}@example.com`,
    ipHash: null,
    topic: 'account' as const,
    body: 'I lost the phone with my authenticator app. Please help me sign in.',
    ...overrides,
  }
}

async function emailsFor(ticketId: string) {
  return db.query(`select kind, status, message_id from public.support_ticket_emails where ticket_id = $1 order by created_at, id`, [ticketId])
}

describe('migration 0089: support tables', () => {
  it('creates the tables with their checks', async () => {
    const tables = await db.query(
      `select table_name from information_schema.tables where table_schema = 'public'
       and table_name in ('site_settings', 'support_tickets', 'support_ticket_messages', 'support_ticket_emails') order by table_name`,
    )
    expect(tables.map((row) => row.table_name)).toEqual(['site_settings', 'support_ticket_emails', 'support_ticket_messages', 'support_tickets'])
    await expect(db.query(`insert into public.support_tickets (sender_name, sender_email, topic) values ('Placeholder', 'p@example.com', 'gossip')`)).rejects.toThrow()
    await expect(db.query(`insert into public.support_tickets (sender_name, sender_email, topic, status) values ('Placeholder', 'p@example.com', 'other', 'pending')`)).rejects.toThrow()
    await expect(db.query(`insert into public.support_tickets (sender_name, sender_email, topic, status) values ('Placeholder', 'p@example.com', 'other', 'closed')`)).rejects.toThrow()
    await expect(db.query(`insert into public.support_tickets (sender_name, sender_email, topic) values ('  ', 'p@example.com', 'other')`)).rejects.toThrow()
  })
})

describe('Contact page tickets', () => {
  it('saves a visitor ticket with its first message and queues one email to operations', async () => {
    const result = await repository().createTicket(ticketInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [ticket] = await db.query(`select status, sender_profile_id, closed_at from public.support_tickets where id = $1`, [result.ticketId])
    expect(ticket).toMatchObject({ status: 'open', sender_profile_id: null, closed_at: null })
    const messages = await db.query(`select author_role from public.support_ticket_messages where ticket_id = $1`, [result.ticketId])
    expect(messages.map((row) => row.author_role)).toEqual(['visitor'])
    expect((await emailsFor(result.ticketId)).map((row) => [row.kind, row.status])).toEqual([['operations_new_ticket', 'pending']])
  })

  it('links a signed-in member’s ticket to their profile and lists only their own tickets', async () => {
    const member = await profile('Placeholder Member')
    const other = await profile('Placeholder Other')
    const repo = repository()
    const mine = await repo.createTicket(ticketInput({ senderProfileId: member, topic: 'payments' }))
    await repo.createTicket(ticketInput({ senderProfileId: other }))
    expect(mine.ok).toBe(true)
    if (!mine.ok) return
    const list = await repo.listTicketsForMember(member)
    expect(list.map((ticket) => ticket.id)).toEqual([mine.ticketId])
    expect(list[0]).toMatchObject({ topic: 'payments', status: 'open' })
    expect(list[0]!.preview).toContain('authenticator')
    expect(await repo.getTicketForMember(other, mine.ticketId)).toBeNull()
    const detail = await repo.getTicketForMember(member, mine.ticketId)
    expect(detail?.messages.map((message) => message.authorRole)).toEqual(['member'])
  })

  it('account deletion removes the member’s tickets, with their messages and queued emails (cascade)', async () => {
    const member = await profile('Placeholder Leaving Member')
    const other = await profile('Placeholder Staying Member')
    const repo = repository()
    const mine = await repo.createTicket(ticketInput({ senderProfileId: member }))
    const theirs = await repo.createTicket(ticketInput({ senderProfileId: other }))
    if (!mine.ok || !theirs.ok) throw new Error('tickets were not created')
    expect(await emailsFor(mine.ticketId)).not.toHaveLength(0)

    // The statement src/features/account-deletion/repository.ts runs.
    await db.query(`delete from public.support_tickets where sender_profile_id = $1`, [member])

    expect(await db.query(`select id from public.support_ticket_messages where ticket_id = $1`, [mine.ticketId])).toHaveLength(0)
    expect(await emailsFor(mine.ticketId)).toHaveLength(0)
    expect(await repo.getTicketForMember(other, theirs.ticketId)).not.toBeNull()
  })

  it('limits new tickets per email address, per hashed IP and per member', async () => {
    const repo = repository()
    const email = 'limited@example.com'
    for (let index = 0; index < SUPPORT_TICKET_LIMITS.perEmail; index += 1) {
      expect((await repo.createTicket(ticketInput({ senderEmail: email }))).ok).toBe(true)
    }
    expect(await repo.createTicket(ticketInput({ senderEmail: 'LIMITED@example.com' }))).toEqual({ ok: false, reason: 'rate_limited' })

    const ipHash = 'a'.repeat(32)
    for (let index = 0; index < SUPPORT_TICKET_LIMITS.perIp; index += 1) {
      expect((await repo.createTicket(ticketInput({ ipHash }))).ok).toBe(true)
    }
    expect(await repo.createTicket(ticketInput({ ipHash }))).toEqual({ ok: false, reason: 'rate_limited' })

    const member = await profile('Placeholder Busy Member')
    for (let index = 0; index < SUPPORT_TICKET_LIMITS.perProfile; index += 1) {
      expect((await repo.createTicket(ticketInput({ senderProfileId: member }))).ok).toBe(true)
    }
    expect(await repo.createTicket(ticketInput({ senderProfileId: member }))).toEqual({ ok: false, reason: 'rate_limited' })

    // Older tickets fall out of the window.
    await db.query(`update public.support_tickets set created_at = now() - interval '2 hours' where lower(sender_email) = $1`, [email])
    expect((await repo.createTicket(ticketInput({ senderEmail: email }))).ok).toBe(true)
  })
})

describe('answers, member replies and status', () => {
  it('admin reply marks the ticket answered, queues the email to the sender and is audited', async () => {
    const member = await profile('Placeholder Member')
    const admin = await profile('Placeholder Admin')
    const repo = repository()
    const created = await repo.createTicket(ticketInput({ senderProfileId: member }))
    if (!created.ok) throw new Error('ticket not created')

    expect(await repo.replyAsAdmin(admin, created.ticketId, 'Thanks for writing. Please confirm the email on your account.')).toEqual({ ok: true })
    const [ticket] = await db.query(`select status from public.support_tickets where id = $1`, [created.ticketId])
    expect(ticket!.status).toBe('answered')
    expect((await emailsFor(created.ticketId)).map((row) => row.kind)).toEqual(['operations_new_ticket', 'sender_admin_reply'])
    const audit = await db.query(`select action, actor_id from public.audit_events where target_type = 'support_ticket' and target_id = $1`, [created.ticketId])
    expect(audit).toEqual([{ action: 'support_ticket.replied', actor_id: admin }])

    // The member sees "Sea N Shore support", never the administrator's name; admins see it.
    const memberView = await repo.getTicketForMember(member, created.ticketId)
    expect(memberView?.messages.map((message) => [message.authorRole, message.authorName])).toEqual([['member', null], ['admin', null]])
    const adminView = await repo.getTicketForAdmin(created.ticketId)
    expect(adminView?.messages[1]?.authorName).toMatch(/^Placeholder Admin/)
  })

  it('a member reply reopens an answered ticket and emails operations; closed tickets refuse replies', async () => {
    const member = await profile('Placeholder Member')
    const admin = await profile('Placeholder Admin')
    const repo = repository()
    const created = await repo.createTicket(ticketInput({ senderProfileId: member }))
    if (!created.ok) throw new Error('ticket not created')
    await repo.replyAsAdmin(admin, created.ticketId, 'Placeholder answer from support.')

    expect(await repo.replyAsMember(member, created.ticketId, 'Placeholder follow-up from the member.')).toEqual({ ok: true })
    const [reopened] = await db.query(`select status from public.support_tickets where id = $1`, [created.ticketId])
    expect(reopened!.status).toBe('open')
    expect((await emailsFor(created.ticketId)).map((row) => row.kind)).toEqual(['operations_new_ticket', 'sender_admin_reply', 'operations_member_reply'])

    const stranger = await profile('Placeholder Stranger')
    expect(await repo.replyAsMember(stranger, created.ticketId, 'Not my ticket.')).toEqual({ ok: false, reason: 'not_found' })

    expect(await repo.setStatusAsAdmin(admin, created.ticketId, 'closed')).toEqual({ ok: true, status: 'closed' })
    const [closed] = await db.query(`select status, closed_at from public.support_tickets where id = $1`, [created.ticketId])
    expect(closed!.status).toBe('closed')
    expect(closed!.closed_at).not.toBeNull()
    expect(await repo.setStatusAsAdmin(admin, created.ticketId, 'closed')).toEqual({ ok: false, reason: 'unchanged' })
    expect(await repo.replyAsMember(member, created.ticketId, 'Too late.')).toEqual({ ok: false, reason: 'closed' })
    expect(await repo.replyAsAdmin(admin, created.ticketId, 'Too late.')).toEqual({ ok: false, reason: 'closed' })

    expect(await repo.setStatusAsAdmin(admin, created.ticketId, 'open')).toEqual({ ok: true, status: 'open' })
    const [open] = await db.query(`select status, closed_at from public.support_tickets where id = $1`, [created.ticketId])
    expect(open).toMatchObject({ status: 'open', closed_at: null })
    const actions = await db.query(`select action from public.audit_events where target_id = $1 order by created_at, id`, [created.ticketId])
    expect(actions.map((row) => row.action)).toEqual(['support_ticket.replied', 'support_ticket.closed', 'support_ticket.reopened'])
  })

  it('lists tickets for admins by status with counts, open first', async () => {
    const result = await repository().listTicketsForAdmin({ status: 'all', limit: 100 })
    expect(result.counts.open).toBeGreaterThan(0)
    expect(result.tickets.length).toBeGreaterThan(0)
    const openOnly = await repository().listTicketsForAdmin({ status: 'open', limit: 100 })
    expect(openOnly.tickets.every((ticket) => ticket.status === 'open')).toBe(true)
    expect(openOnly.tickets.length).toBe(Math.min(100, result.counts.open))
  })

  it('refuses ids that are not ticket ids without querying', async () => {
    const repo = repository()
    expect(await repo.getTicketForAdmin('not-a-uuid')).toBeNull()
    expect(await repo.replyAsAdmin('x', 'not-a-uuid', 'Hello')).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('the ticket email worker', () => {
  it('sends each queued email once, to operations or to the sender, and skips stale rows', async () => {
    await db.query(`update public.support_ticket_emails set status = 'skipped' where status = 'pending'`)
    const member = await profile('Placeholder Member')
    const admin = await profile('Placeholder Admin')
    const repo = repository()
    const memberTicket = await repo.createTicket(ticketInput({ senderProfileId: member, senderEmail: 'member-reply@example.com' }))
    const visitorTicket = await repo.createTicket(ticketInput({ senderEmail: 'visitor-reply@example.com' }))
    if (!memberTicket.ok || !visitorTicket.ok) throw new Error('tickets not created')
    await repo.replyAsAdmin(admin, memberTicket.ticketId, 'Placeholder answer for the member.')
    await repo.replyAsAdmin(admin, visitorTicket.ticketId, 'Placeholder answer for the visitor.')
    const stale = await repo.createTicket(ticketInput())
    if (!stale.ok) throw new Error('ticket not created')
    await db.query(`update public.support_ticket_emails set created_at = now() - interval '8 days' where ticket_id = $1`, [stale.ticketId])

    type SentEmail = { to: string; subject: string; replyTo?: string; idempotencyKey?: string }
    let sentCount = 0
    const sendEmail = vi.fn<(input: SentEmail) => Promise<{ messageId: string }>>(async () => {
      sentCount += 1
      return { messageId: `msg-${sentCount}` }
    })
    const worker = createSupportEmailWorker({ repository: createSupportEmailRepository({ query, transaction }), resend: { sendEmail } as never, siteUrl: 'https://example.com' })
    const first = await worker.runSweep(25)
    expect(first).toMatchObject({ claimed: 5, sent: 4, skipped: 1, failed: 0, disabled: false })

    const sent = sendEmail.mock.calls.map(([input]) => input)
    expect(sent.filter((input) => input.to === SUPPORT_OPERATIONS_EMAIL)).toHaveLength(2)
    const toMember = sent.find((input) => input.to === 'member-reply@example.com')!
    const toVisitor = sent.find((input) => input.to === 'visitor-reply@example.com')!
    expect(toMember.replyTo).toBeUndefined()
    expect(toVisitor.replyTo).toBe(SUPPORT_OPERATIONS_EMAIL)
    expect(new Set(sent.map((input) => input.idempotencyKey)).size).toBe(4)

    const second = await worker.runSweep(25)
    expect(second.claimed).toBe(0)
    expect(sendEmail).toHaveBeenCalledTimes(4)
    const [staleRow] = await db.query(`select status, last_error from public.support_ticket_emails where ticket_id = $1`, [stale.ticketId])
    expect(staleRow).toMatchObject({ status: 'skipped', last_error: 'stale' })
  })

  it('stays quiet until the queue table exists, and is disabled without a Resend key', async () => {
    const repo = createSupportEmailRepository({ query, transaction })
    expect(await repo.tableReady()).toBe(true)
    const disabled = createSupportEmailWorker({ repository: repo, loadApiKey: async () => null })
    expect(await disabled.runSweep()).toMatchObject({ disabled: true, claimed: 0 })

    let checks = 0
    const sweep = createSupportEmailSweep({
      repository: { ...repo, tableReady: async () => { checks += 1; return false } },
      worker: { runSweep: vi.fn() } as never,
      now: () => 1_000,
    })
    expect(await sweep.run()).toBeUndefined()
    expect(await sweep.run()).toBeUndefined()
    expect(checks).toBe(1)
  })
})
