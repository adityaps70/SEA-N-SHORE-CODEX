import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const path = 'infra/aws/database/migrations/0009_feed_social_interactions.sql'
const sql = readFileSync(path, 'utf8').toLowerCase()
const normalized = sql.replace(/\s+/g, ' ')

test('feed social interaction migration is additive and exact', () => {
  assert.doesNotMatch(sql, /\b(drop|truncate)\b|\bdelete\s+from\b|\bupdate\s+/i)
  assert.match(normalized, /alter type public\.post_reaction_type add value if not exists 'support'/)
  assert.match(normalized, /alter type public\.post_reaction_type add value if not exists 'respect'/)
  assert.match(normalized, /alter type public\.post_reaction_type add value if not exists 'on_point'/)
  for (const value of ['post_comment', 'comment_reply', 'post_reaction', 'comment_reaction', 'post_mention', 'comment_mention']) {
    assert.ok(normalized.includes(`alter type public.network_notification_type add value if not exists '${value}'`))
  }
  assert.ok(normalized.includes('add column if not exists parent_comment_id uuid'))
  assert.ok(normalized.includes('post_comments_parent_same_post_fk'))
  assert.ok(normalized.includes('create table if not exists public.comment_reactions'))
  assert.ok(normalized.includes('primary key (comment_id, user_id)'))
  assert.ok(normalized.includes('create table if not exists public.content_mentions'))
  assert.ok(normalized.includes('content_mentions_exact_target'))
  assert.ok(normalized.includes('content_mentions_post_unique_idx'))
  assert.ok(normalized.includes('content_mentions_comment_unique_idx'))
  assert.ok(normalized.includes('add column if not exists dedupe_key text'))
  assert.ok(normalized.includes('notifications_recipient_dedupe_unique_idx'))
})

test('migration only uses approved additive statement families', () => {
  const parts = sql.split(/^\s*-- statement-breakpoint\s*$/m).map((part) => part.trim()).filter(Boolean)
  assert.equal(parts.length, 28)
  for (const part of parts) {
    assert.match(part, /^(alter type public\.(post_reaction_type|network_notification_type) add value if not exists '[a-z_]+'|alter table public\.(post_comments|notifications) add (column if not exists|constraint)\b|create table if not exists public\.(comment_reactions|content_mentions)\b|create (unique )?index if not exists\b)/i)
    assert.ok(part.endsWith(';'))
  }
})
