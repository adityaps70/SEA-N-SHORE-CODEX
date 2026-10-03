import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NEWSLETTER_TOPIC_IDS } from './topics'

const sql = readFileSync(join(process.cwd(), 'infra/aws/database/migrations/0036_newsletter_subscriptions.sql'), 'utf8')

describe('newsletter database contract (migration 0036)', () => {
  it('creates subscribers with a unique normalised email, nullable profile and constrained status', () => {
    expect(sql).toMatch(/create table if not exists public\.newsletter_subscribers/i)
    expect(sql).toMatch(/create unique index if not exists newsletter_subscribers_email_key\s+on public\.newsletter_subscribers \(email\)/i)
    expect(sql).toMatch(/email = lower\(btrim\(email\)\)/)
    expect(sql).toMatch(/profile_id uuid references public\.profiles\(id\) on delete set null/)
    expect(sql).toMatch(/status in \('pending', 'subscribed', 'unsubscribed'\)/)
    expect(sql).toMatch(/ses_sync_status in \('not_required', 'pending', 'synced', 'failed'\)/)
  })

  it('keeps an append-only consent history with minimal personal data', () => {
    expect(sql).toMatch(/create table if not exists public\.newsletter_consent_events/i)
    expect(sql).toMatch(/consent_text_version text/)
    expect(sql).toMatch(/ip_hash text/)
    expect(sql).toMatch(/user_agent_summary text/)
    expect(sql).not.toMatch(/\bip_address\b|\buser_agent text\b/)
    expect(sql).toMatch(/before update on public\.newsletter_consent_events/)
  })

  it('allows exactly the topics the application offers', () => {
    for (const topic of NEWSLETTER_TOPIC_IDS) expect(sql).toContain(`'${topic}'`)
  })

  it('is idempotent and non-destructive', () => {
    expect(sql).not.toMatch(/\bdrop table\b|\btruncate\b|\bdelete from\b/i)
    const creates = sql.match(/create (table|unique index|index) /gi) ?? []
    const guarded = sql.match(/create (table|unique index|index) if not exists /gi) ?? []
    expect(guarded.length).toBe(creates.length)
    expect(sql).toMatch(/drop trigger if exists newsletter_consent_events_no_update/)
    expect(sql).toMatch(/create or replace function public\.newsletter_consent_events_append_only/)
  })
})
