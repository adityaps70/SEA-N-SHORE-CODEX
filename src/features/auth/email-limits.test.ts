import { describe, expect, it, vi } from 'vitest'
import {
  AUTH_EMAIL_LIMITS,
  AUTH_EMAIL_PRUNE_BATCH,
  createAuthEmailLimiter,
  deriveAuthEmailLimitKey,
  hashAuthEmail,
  hashAuthIp,
  isDatabaseConnectivityError,
  type AuthEmailAction,
  type AuthEmailLimitQuery,
} from './email-limits'

const SECRET = 's'.repeat(48)
const EMAIL = 'Captain.Nemo@Example.com'
const IP = '203.0.113.7'

type Row = { id: number; action: string; email_hash: string; ip_hash: string | null; created_at: number }

const HOUR = 3_600_000
const DAY = 24 * HOUR

function intervalMs(value: unknown) {
  if (value === '1 hour') return HOUR
  if (value === '2 days') return 2 * DAY
  throw new Error(`unexpected interval ${String(value)}`)
}

/** A tiny in-memory stand-in for public.auth_email_events that understands the limiter's queries. */
function fakeDatabase(options: { tableExists?: boolean } = {}) {
  let now = Date.UTC(2026, 9, 4, 12, 0, 0)
  let nextId = 1
  const rows: Row[] = []
  const calls: Array<{ text: string; values: readonly unknown[] }> = []

  const query: AuthEmailLimitQuery = async (text, values = []) => {
    calls.push({ text, values })
    if (text.includes('to_regclass')) return [{ locked: '', ready: options.tableExists !== false }]
    if (text.includes(':ip:')) return [{ locked: '' }]
    if (text.includes('as email_total')) {
      const [action, emailHash, ipHash, window, perEmail, perIp] = values
      const since = now - intervalMs(window)
      const recent = rows.filter((row) => row.action === action && row.created_at > since)
      return [{
        email_total: Math.min(recent.filter((row) => row.email_hash === emailHash).length, Number(perEmail)),
        ip_total: ipHash === null ? 0 : Math.min(recent.filter((row) => row.ip_hash === ipHash).length, Number(perIp)),
      }]
    }
    if (text.includes('insert into public.auth_email_events')) {
      const [action, emailHash, ipHash, retention, batch] = values
      const before = now - intervalMs(retention)
      const prune = (match: (row: Row) => boolean) => {
        const victims = rows.filter((row) => row.action === action && match(row) && row.created_at < before)
          .sort((a, b) => a.created_at - b.created_at)
          .slice(0, Number(batch))
        for (const victim of victims) rows.splice(rows.indexOf(victim), 1)
      }
      prune((row) => row.email_hash === emailHash)
      if (ipHash !== null) prune((row) => row.ip_hash === ipHash)
      rows.push({ id: nextId++, action: String(action), email_hash: String(emailHash), ip_hash: ipHash as string | null, created_at: now })
      return []
    }
    throw new Error(`unexpected query: ${text}`)
  }

  return {
    rows,
    calls,
    query,
    advance(ms: number) { now += ms },
    withTransaction: async <T,>(fn: (q: AuthEmailLimitQuery) => Promise<T>) => fn(query),
  }
}

function setup(options: { tableExists?: boolean; secret?: string | null } = {}) {
  const db = fakeDatabase(options)
  const warn = vi.fn()
  const limiter = createAuthEmailLimiter({
    withTransaction: db.withTransaction,
    getKey: () => deriveAuthEmailLimitKey(options.secret === undefined ? SECRET : options.secret),
    warn,
  })
  return { db, warn, limiter }
}

async function attempt(limiter: ReturnType<typeof setup>['limiter'], action: AuthEmailAction, email = EMAIL, ip: string | null = IP) {
  return limiter.consume({ action, email, ip })
}

describe('auth email limits', () => {
  it('uses the agreed per-email and per-IP hourly limits', () => {
    expect(AUTH_EMAIL_LIMITS).toEqual({
      sign_up: { perEmail: 3, perIp: 10, window: '1 hour' },
      resend_code: { perEmail: 5, perIp: 15, window: '1 hour' },
      password_reset: { perEmail: 5, perIp: 15, window: '1 hour' },
    })
  })

  it.each([
    ['sign_up', 3],
    ['resend_code', 5],
    ['password_reset', 5],
  ] as const)('allows %s %i times per email per hour, then refuses without recording', async (action, limit) => {
    const { db, limiter } = setup()
    for (let index = 0; index < limit; index += 1) {
      await expect(attempt(limiter, action)).resolves.toEqual({ allowed: true, counted: true })
    }
    await expect(attempt(limiter, action)).resolves.toEqual({ allowed: false, reason: 'rate_limited', scope: 'email' })
    expect(db.rows).toHaveLength(limit)
  })

  it('treats the email case- and whitespace-insensitively', async () => {
    const { limiter } = setup()
    await attempt(limiter, 'sign_up', 'captain.nemo@example.com')
    await attempt(limiter, 'sign_up', ' CAPTAIN.NEMO@EXAMPLE.COM ')
    await attempt(limiter, 'sign_up', 'Captain.Nemo@example.com')
    await expect(attempt(limiter, 'sign_up', 'captain.nemo@EXAMPLE.com')).resolves.toMatchObject({ allowed: false, scope: 'email' })
  })

  it('counts a rolling one-hour window', async () => {
    const { db, limiter } = setup()
    for (let index = 0; index < 3; index += 1) await attempt(limiter, 'sign_up')
    db.advance(59 * 60_000)
    await expect(attempt(limiter, 'sign_up')).resolves.toMatchObject({ allowed: false })
    db.advance(2 * 60_000)
    await expect(attempt(limiter, 'sign_up')).resolves.toEqual({ allowed: true, counted: true })
  })

  it('limits one IP across many addresses, separately from the per-email limit', async () => {
    const { limiter } = setup()
    for (let index = 0; index < 10; index += 1) {
      await expect(attempt(limiter, 'sign_up', `member${index}@example.com`)).resolves.toMatchObject({ allowed: true })
    }
    await expect(attempt(limiter, 'sign_up', 'member99@example.com')).resolves.toEqual({ allowed: false, reason: 'rate_limited', scope: 'ip' })
    // Another network may still sign up that address.
    await expect(attempt(limiter, 'sign_up', 'member99@example.com', '198.51.100.20')).resolves.toMatchObject({ allowed: true })
  })

  it('allows 15 resends and 15 resets per IP per hour', async () => {
    const { limiter } = setup()
    for (const action of ['resend_code', 'password_reset'] as const) {
      for (let index = 0; index < 15; index += 1) {
        await expect(attempt(limiter, action, `crew${index}@example.com`)).resolves.toMatchObject({ allowed: true })
      }
      await expect(attempt(limiter, action, 'crew99@example.com')).resolves.toMatchObject({ allowed: false, scope: 'ip' })
    }
  })

  it('keeps the three flows independent', async () => {
    const { limiter } = setup()
    for (let index = 0; index < 3; index += 1) await attempt(limiter, 'sign_up')
    await expect(attempt(limiter, 'sign_up')).resolves.toMatchObject({ allowed: false })
    await expect(attempt(limiter, 'resend_code')).resolves.toMatchObject({ allowed: true })
    await expect(attempt(limiter, 'password_reset')).resolves.toMatchObject({ allowed: true })
  })

  it('applies only the per-email limit when the client IP is unknown', async () => {
    const { db, limiter } = setup()
    for (let index = 0; index < 12; index += 1) {
      await expect(attempt(limiter, 'sign_up', `deck${index}@example.com`, null)).resolves.toMatchObject({ allowed: true })
    }
    expect(db.rows.every((row) => row.ip_hash === null)).toBe(true)
    expect(db.calls.some((call) => call.text.includes(':ip:'))).toBe(false)
  })

  it('prunes the key\'s rows older than 2 days, a bounded batch at a time', async () => {
    const { db, limiter } = setup()
    await attempt(limiter, 'password_reset')
    await attempt(limiter, 'password_reset', 'other@example.com', '198.51.100.1')
    db.advance(3 * DAY)
    await attempt(limiter, 'password_reset')
    expect(db.rows).toHaveLength(2)
    expect(db.rows.some((row) => row.ip_hash === hashAuthIp('198.51.100.1', deriveAuthEmailLimitKey(SECRET)!))).toBe(true)
    const insert = db.calls.find((call) => call.text.includes('insert into public.auth_email_events'))
    expect(insert?.values).toEqual([
      'password_reset',
      expect.any(String),
      expect.any(String),
      '2 days',
      AUTH_EMAIL_PRUNE_BATCH,
    ])
    expect(insert?.text).toMatch(/limit \$5/)
  })

  it('locks the email key before the IP key and checks the table in the first statement', async () => {
    const { db, limiter } = setup()
    await attempt(limiter, 'resend_code')
    expect(db.calls[0]?.text).toMatch(/pg_advisory_xact_lock\(hashtext\('auth_email_limit:' \|\| \$1::text \|\| ':email:'/)
    expect(db.calls[0]?.text).toMatch(/to_regclass\('public\.auth_email_events'\) is not null as ready/)
    expect(db.calls[1]?.text).toMatch(/':ip:'/)
  })

  it('never sends or logs the raw email or IP; only keyed hashes', async () => {
    const { db, warn, limiter } = setup()
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (let index = 0; index < 4; index += 1) await attempt(limiter, 'sign_up')
    const key = deriveAuthEmailLimitKey(SECRET)!
    const everything = JSON.stringify({ calls: db.calls, rows: db.rows, warn: warn.mock.calls, log: log.mock.calls })
    expect(everything).not.toContain(IP)
    expect(everything.toLowerCase()).not.toContain('captain.nemo')
    expect(everything).not.toContain('example.com')
    expect(db.rows[0]?.email_hash).toBe(hashAuthEmail(EMAIL, key))
    expect(db.rows[0]?.email_hash).toMatch(/^[0-9a-f]{32}$/)
    expect(db.rows[0]?.ip_hash).toBe(hashAuthIp(IP, key))
    expect(warn).toHaveBeenCalledWith('[auth_email_limited]', { action: 'sign_up', scope: 'email' })
    log.mockRestore()
  })

  it('derives a key that differs from the raw secret and from the newsletter IP hash', async () => {
    const key = deriveAuthEmailLimitKey(SECRET)!
    expect(key.toString('hex')).not.toContain(Buffer.from(SECRET).toString('hex'))
    const { hashClientIp } = await import('@/features/newsletter/privacy')
    expect(hashAuthIp(IP, key)).not.toBe(hashClientIp(IP, SECRET))
    expect(deriveAuthEmailLimitKey('short')).toBeNull()
    expect(deriveAuthEmailLimitKey(null)).toBeNull()
  })

  describe('failure handling', () => {
    it('fails open, without counting, when the events table does not exist yet', async () => {
      const { db, warn, limiter } = setup({ tableExists: false })
      await expect(attempt(limiter, 'sign_up')).resolves.toEqual({ allowed: true, counted: false })
      expect(db.calls).toHaveLength(1)
      expect(warn).toHaveBeenCalledWith('[auth_email_limit_skipped]', { action: 'sign_up', reason: 'events_table_missing' })
    })

    it.each([
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      new Error('timeout exceeded when trying to connect'),
      new Error('Connection terminated unexpectedly'),
      Object.assign(new Error('sorry, too many clients already'), { code: '53300' }),
      Object.assign(new Error('connection failure'), { code: '08006' }),
      Object.assign(new Error('the database system is starting up'), { code: '57P03' }),
      Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
      Object.assign(new Error('password authentication failed for user "app"'), { code: '28P01' }),
    ])('fails open with a safe warning when the database is unreachable (%s)', async (error) => {
      const warn = vi.fn()
      const limiter = createAuthEmailLimiter({
        withTransaction: async () => { throw error },
        getKey: () => deriveAuthEmailLimitKey(SECRET),
        warn,
      })
      await expect(attempt(limiter, 'password_reset')).resolves.toEqual({ allowed: true, counted: false })
      expect(warn).toHaveBeenCalledWith('[auth_email_limit_skipped]', expect.objectContaining({
        action: 'password_reset',
        reason: 'database_unavailable',
      }))
      expect(JSON.stringify(warn.mock.calls)).not.toContain(IP)
      expect(JSON.stringify(warn.mock.calls)).not.toContain('10.0.0.1')
    })

    it.each([
      Object.assign(new Error('permission denied for table auth_email_events'), { code: '42501' }),
      Object.assign(new Error('column "email_hash" does not exist'), { code: '42703' }),
      new Error('something unexpected'),
    ])('fails closed on other errors, logging only a code (%s)', async (error) => {
      const warn = vi.fn()
      const limiter = createAuthEmailLimiter({
        withTransaction: async () => { throw error },
        getKey: () => deriveAuthEmailLimitKey(SECRET),
        warn,
      })
      await expect(attempt(limiter, 'sign_up')).resolves.toEqual({ allowed: false, reason: 'unavailable' })
      expect(warn).toHaveBeenCalledTimes(1)
      const [tag, context] = warn.mock.calls[0] ?? []
      expect(tag).toBe('[auth_email_limit_failed]')
      expect(Object.keys(context as object).sort()).toEqual(['action', 'code'])
      expect(JSON.stringify(context)).not.toMatch(/permission|column|unexpected/)
    })

    it('fails open when no hashing secret is configured, without touching the database', async () => {
      const db = fakeDatabase()
      const warn = vi.fn()
      const limiter = createAuthEmailLimiter({ withTransaction: db.withTransaction, getKey: () => deriveAuthEmailLimitKey(undefined), warn })
      await expect(attempt(limiter, 'sign_up')).resolves.toEqual({ allowed: true, counted: false })
      expect(db.calls).toHaveLength(0)
      expect(warn).toHaveBeenCalledWith('[auth_email_limit_skipped]', { action: 'sign_up', reason: 'hash_secret_missing' })
    })

    it('fails open when no database is configured for this process', async () => {
      const db = fakeDatabase()
      const warn = vi.fn()
      const limiter = createAuthEmailLimiter({
        withTransaction: db.withTransaction,
        getKey: () => deriveAuthEmailLimitKey(SECRET),
        isDatabaseConfigured: () => false,
        warn,
      })
      await expect(attempt(limiter, 'resend_code')).resolves.toEqual({ allowed: true, counted: false })
      expect(db.calls).toHaveLength(0)
      expect(warn).toHaveBeenCalledWith('[auth_email_limit_skipped]', { action: 'resend_code', reason: 'database_not_configured' })
    })

    it('classifies connectivity errors narrowly', () => {
      expect(isDatabaseConnectivityError(Object.assign(new Error('x'), { code: '08001' }))).toBe(true)
      expect(isDatabaseConnectivityError(Object.assign(new Error('x'), { code: '42P01' }))).toBe(false)
      expect(isDatabaseConnectivityError(Object.assign(new Error('x'), { code: '23505' }))).toBe(false)
      expect(isDatabaseConnectivityError(new Error('syntax error at or near "selec"'))).toBe(false)
      expect(isDatabaseConnectivityError('ECONNREFUSED')).toBe(false)
    })
  })
})
