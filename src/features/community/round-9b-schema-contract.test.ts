import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const groupsMigration = 'infra/aws/database/migrations/0055_community_groups_tagging.sql'
const notificationMigration = 'infra/aws/database/migrations/0056_community_tagging_notifications.sql'
const sql = (path: string) => readFileSync(resolve(root, path), 'utf8')

function statements(text: string) {
  return text
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
}

/** The launch groups, formerly the static Community page. "Events inside groups" was a feature blurb, not a group. */
export const SEEDED_GROUP_SLUGS = [
  'tanker-professionals',
  'masters-senior-officers',
  'marine-engineers',
  'cadets-community',
  'ask-the-community',
] as const

describe('round 9B community + tagging schema', () => {
  it('is the only 0055 / 0056 migration, split into statements the guard accepts', () => {
    const names = readdirSync(resolve(root, 'infra/aws/database/migrations'))
    expect(names.filter((name) => name.startsWith('0055_'))).toEqual(['0055_community_groups_tagging.sql'])
    expect(names.filter((name) => name.startsWith('0056_'))).toEqual(['0056_community_tagging_notifications.sql'])
    expect(existsSync(resolve(root, 'scripts/aws/round-9b-migration.sh'))).toBe(true)
    expect(readFileSync(resolve(root, 'scripts/aws/round-9b-migration-action.txt'), 'utf8').trim()).toBe('plan')
    for (const path of [groupsMigration, notificationMigration]) {
      for (const statement of statements(sql(path))) {
        expect(statement.endsWith(';'), statement.slice(0, 80)).toBe(true)
        expect(statement).not.toMatch(/\b(drop\s+(table|column|type|schema)|truncate|delete\s+from|concurrently)\b/i)
      }
    }
  })

  it('creates the group, membership, tagging and hashtag tables additively', () => {
    const text = sql(groupsMigration)
    for (const fragment of [
      'create table if not exists public.community_groups',
      "visibility in ('public', 'private')",
      'create table if not exists public.community_group_memberships',
      "role in ('member', 'admin', 'owner')",
      "status in ('active', 'pending', 'removed')",
      'alter table public.posts add column if not exists group_id uuid references public.community_groups(id) on delete set null',
      'create table if not exists public.content_organization_mentions',
      'create table if not exists public.post_photo_tags',
      'create table if not exists public.hashtags',
      "tag ~ '^[a-z0-9_]{1,64}$'",
      'create table if not exists public.post_hashtags',
      'create table if not exists public.hashtag_follows',
      'alter table public.notifications add column if not exists group_id uuid',
      'alter table public.notifications add column if not exists company_id uuid',
      "target_type in ('post', 'comment', 'job', 'event', 'profile', 'group')",
    ]) {
      expect(text, fragment).toContain(fragment)
    }
  })

  it('seeds the five launch groups as public groups owned by the platform administrator', () => {
    const text = sql(groupsMigration)
    for (const slug of SEEDED_GROUP_SLUGS) expect(text).toContain(`'${slug}'`)
    expect(text).toContain("ur.role::text = 'administrator'")
    expect(text).toContain("select g.id, g.created_by, 'owner', 'active', now()")
    expect(text).toContain('where not exists (\n  select 1 from public.community_groups existing where existing.slug = seed.slug\n)')
    expect(text).not.toContain("'events-inside-groups'")
  })

  it('adds every round 9B notification type in its own file', () => {
    const text = sql(notificationMigration)
    for (const type of ['group_join_request', 'group_join_approved', 'group_post', 'organization_mention', 'photo_tag']) {
      expect(text).toContain(`alter type public.network_notification_type add value if not exists '${type}';`)
    }
  })
})
