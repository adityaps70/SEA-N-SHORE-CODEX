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
