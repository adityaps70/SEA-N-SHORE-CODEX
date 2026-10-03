import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { POST_CATEGORIES, POST_CATEGORY_LABELS } from '@/features/feed/types'
import { COMMUNITY_CATEGORY_ICONS } from './group-icons'
import { groupSlugFromName } from './slug'
import { COMMUNITY_CATEGORIES, GROUP_ICON_NAMES } from './types'

const sql = readFileSync('infra/aws/database/migrations/0061_community_categories.sql', 'utf8')
const statements = sql.split(/^\s*-- statement-breakpoint\s*$/m).map((part) => part.trim()).filter(Boolean)

describe('migration 0061: community categories (round 10)', () => {
  it('is non-destructive and split into the seven statements the guarded script expects', () => {
    expect(statements).toHaveLength(7)
    expect(sql).not.toMatch(/drop\s+(table|column|type|schema)|truncate|delete\s+from/i)
    expect(sql).toContain('add column if not exists category text')
    expect(sql).toContain('community_groups_category_check')
  })

  it('allows exactly the feed post categories', () => {
    expect(COMMUNITY_CATEGORIES).toEqual(POST_CATEGORIES)
    for (const category of POST_CATEGORIES) expect(statements[2]).toContain(`'${category}'`)
  })

  it('seeds one public, open community per category with the same name, slug, icon and category, skipping existing names', () => {
    const seed = statements[4]
    for (const category of POST_CATEGORIES) {
      const name = POST_CATEGORY_LABELS[category]
      expect(seed).toContain(`('${name}'::text, '${groupSlugFromName(name)}'::text, '${category}'::text, '${COMMUNITY_CATEGORY_ICONS[category]}'::text,`)
      expect(statements[5]).toContain(`'${groupSlugFromName(name)}'`)
      expect(GROUP_ICON_NAMES).toContain(COMMUNITY_CATEGORY_ICONS[category])
    }
    expect(seed).toContain("'public',\n  'open',")
    expect(seed).toContain("ur.role::text = 'administrator'")
    expect(seed).toContain('lower(btrim(existing.name)) = lower(seed.name)')
    expect(statements[5]).toContain('on conflict (group_id, profile_id) do nothing')
  })

  it('only fills a category on the launch groups when none is set', () => {
    expect(statements[6]).toContain('and g.category is null')
  })
})
