import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GROUP_JOIN_POLICIES, GROUP_ROLE_LABELS } from './types'

const root = process.cwd()
const migration = 'infra/aws/database/migrations/0057_community_images_join_policy.sql'
const sql = (path: string) => readFileSync(resolve(root, path), 'utf8')

function statements(text: string) {
  return text
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
}

describe('round 9C community images, ownership and join policy schema', () => {
  it('is the only 0057 migration, split into statements the guard accepts', () => {
    const names = readdirSync(resolve(root, 'infra/aws/database/migrations'))
    expect(names.filter((name) => name.startsWith('0057_'))).toEqual(['0057_community_images_join_policy.sql'])
    expect(existsSync(resolve(root, 'scripts/aws/round-9c-migration.sh'))).toBe(true)
    expect(readFileSync(resolve(root, 'scripts/aws/round-9c-migration-action.txt'), 'utf8').trim()).toBe('plan')
    for (const statement of statements(sql(migration))) {
      expect(statement.endsWith(';'), statement.slice(0, 80)).toBe(true)
      expect(statement).not.toMatch(/\b(drop\s+(table|column|type|schema)|truncate|delete\s+from|concurrently)\b/i)
    }
  })

  it('adds the profile photo, organization owner and join policy columns additively', () => {
    const text = sql(migration)
    expect(text).toContain('alter table public.community_groups add column if not exists icon_path text')
    expect(text).toContain('alter table public.community_groups add column if not exists owner_company_id uuid references public.companies(id) on delete set null')
    expect(text).toContain("alter table public.community_groups add column if not exists join_policy text not null default 'open'")
    expect(text).toContain(`check (join_policy in (${GROUP_JOIN_POLICIES.map((policy) => `'${policy}'`).join(', ')}))`)
    // Private groups created in round 9B keep asking for approval, exactly once.
    expect(text).toContain("set join_policy = 'approval'")
    expect(text).toContain("where visibility = 'private'")
    expect(text).toContain("where applied.name = '0057_community_images_join_policy'")
  })

  it('keeps the stored role values and only relabels admin as Moderator', () => {
    expect(GROUP_ROLE_LABELS).toEqual({ owner: 'Owner', admin: 'Moderator', member: 'Member' })
    expect(sql(migration)).not.toMatch(/community_group_memberships_role_check/)
  })
})
