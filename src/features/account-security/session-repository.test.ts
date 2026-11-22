import { describe, expect, it } from 'vitest'
import { createSessionRepository } from './session-repository'

const ROW = { id: 'session-1', profile_id: 'profile-1', revoked_at: null, reuse_detected_at: null, last_seen_at: '2026-11-18T00:00:00Z' }
const INPUT = {
  profileId: 'profile-1', originHash: 'a'.repeat(64), signInMethod: 'password' as const,
  userAgentSummary: null, city: null, country: null, ipHash: null,
}

function recorder(answers: Array<Array<Record<string, unknown>>>) {
  const statements: string[] = []
  return {
    statements,
    query: async (text: string) => {
      statements.push(text.trim().split(/\s+/)[0]!.toLowerCase())
      return answers.shift() ?? []
    },
  }
}

describe('session repository findOrCreate (owner 18 Nov)', () => {
  it('reads an existing sign-in with one statement and never inserts', async () => {
    const db = recorder([[ROW]])
    const state = await createSessionRepository({ query: db.query }).findOrCreate(INPUT)
    expect(state.id).toBe('session-1')
    expect(db.statements).toEqual(['select'])
  })

  it('inserts a new sign-in, and reads it back when another request inserted it first', async () => {
    const created = recorder([[], [ROW]])
    expect((await createSessionRepository({ query: created.query }).findOrCreate(INPUT)).id).toBe('session-1')
    expect(created.statements).toEqual(['select', 'insert'])

    const raced = recorder([[], [], [ROW]])
    expect((await createSessionRepository({ query: raced.query }).findOrCreate(INPUT)).id).toBe('session-1')
    expect(raced.statements).toEqual(['select', 'insert', 'select'])
  })
})

describe('session repository: refresh recovery columns (owner 19 Nov, migration 0112)', () => {
  it('reads the latest renewal\'s token hash and whether it was seen, and marks it seen with one guarded update', async () => {
    const seenAt = '2026-11-19T00:00:00Z'
    const texts: string[] = []
    const values: unknown[][] = []
    const answers = [[{ ...ROW, renewal_jti_hash: 'b'.repeat(64), renewal_seen_at: null }], [{ ...ROW, renewal_jti_hash: 'b'.repeat(64), renewal_seen_at: seenAt }], []]
    const repository = createSessionRepository({
      query: async (text: string, params?: readonly unknown[]) => {
        texts.push(text)
        values.push([...(params ?? [])])
        return answers.shift() ?? []
      },
    })
    await expect(repository.findOrCreate(INPUT)).resolves.toMatchObject({ renewalJtiHash: 'b'.repeat(64), renewalSeen: false })
    await expect(repository.findOrCreate(INPUT)).resolves.toMatchObject({ renewalSeen: true })
    // Read through to_jsonb, so the same statement works before 0112 (the values then read as null).
    expect(texts[0]).toMatch(/to_jsonb\(session_row\) ->> 'renewal_jti_hash'/)
    await repository.markRenewalSeen('session-1', 'b'.repeat(64))
    expect(texts[2]).toMatch(/set renewal_seen_at = now\(\)[\s\S]*renewal_jti_hash = \$2[\s\S]*renewal_seen_at is null/)
    expect(values[2]).toEqual(['session-1', 'b'.repeat(64)])
  })
})

