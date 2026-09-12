import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = join(
  process.cwd(),
  'infra/aws/database/migrations/0014_messaging.sql',
)

describe('messaging database contract', () => {
  it('defines durable direct conversations, participants and messages', () => {
    expect(existsSync(migrationPath)).toBe(true)

    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/create table(?: if not exists)? public\.conversations/i)
    expect(sql).toMatch(/create table(?: if not exists)? public\.conversation_participants/i)
    expect(sql).toMatch(/create table(?: if not exists)? public\.messages/i)

    expect(sql).toMatch(/direct_user_low_id/i)
    expect(sql).toMatch(/direct_user_high_id/i)
    expect(sql).toMatch(/unique\s*\(\s*direct_user_low_id\s*,\s*direct_user_high_id\s*\)/i)

    expect(sql).toMatch(/last_read_message_id/i)
    expect(sql).toMatch(/last_read_at/i)

    expect(sql).toMatch(/client_message_id/i)
    expect(sql).toMatch(/unique\s*\(\s*sender_profile_id\s*,\s*client_message_id\s*\)/i)

    expect(sql).toMatch(/conversation_id[\s\S]*created_at[\s\S]*id/i)
    expect(sql).toMatch(/create index[\s\S]*conversation_participants/i)
    expect(sql).toMatch(/create index[\s\S]*messages/i)
  })

  it('constrains direct conversations to two different canonical members', () => {
    expect(existsSync(migrationPath)).toBe(true)

    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/type[\s\S]*direct/i)
    expect(sql).toMatch(/direct_user_low_id\s*<>\s*direct_user_high_id/i)
  })
})
