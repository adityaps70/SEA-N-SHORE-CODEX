import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * P4: the final reminder is the last legacy email and the last mode. After it, no more legacy emails to anyone:
 * every earlier mode excludes an address with a final reminder, at prepare time and at send time, and nothing in the
 * schema or the code builds another legacy email on top of it.
 */
const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const migrations = readdirSync(join(root, 'infra/aws/database/migrations')).filter((name) => name.endsWith('.sql'))

describe('the final reminder is the last legacy mode', () => {
  it('the first invitation and the second reminder exclude an address with a final reminder, when preparing and when sending', () => {
    const invites = read('src/features/legacy-invites/repository.ts')
    expect(invites).toContain("and not ${hasFinalReminderSql('candidate.email')}")
    expect(invites).toContain("and not ${hasFinalReminderSql('claimed.email')}")
    const reminders = read('src/features/legacy-invites/reminder-repository.ts')
    // Outside the includeReminder switch, so it applies at send time too.
    expect(reminders).toMatch(/then 'first_not_sent'\n\s+when \$\{hasFinalReminderSql\('invite\.email'\)\} then 'already_reminded'\n\s+\$\{includeReminder/)
  })

  it('no table is built on the final reminder, and only the three legacy email tables exist', () => {
    const legacyTables = new Set<string>()
    for (const name of migrations) {
      const sql = read(`infra/aws/database/migrations/${name}`)
      expect(sql, name).not.toMatch(/references\s+public\.legacy_profile_invite_final_reminders/i)
      for (const match of sql.matchAll(/create table if not exists public\.(legacy_profile_invite\w*)/gi)) legacyTables.add(match[1]!)
    }
    expect([...legacyTables].sort()).toEqual(['legacy_profile_invite_final_reminders', 'legacy_profile_invite_reminders', 'legacy_profile_invites'])
  })

  it('the admin page has exactly three modes, the final reminder last', () => {
    const page = read('src/app/(app)/admin/legacy-invites/page.tsx')
    const modes = [...page.matchAll(/\['(\w+)', '([^']+)', '\/admin\/legacy-invites[^']*'\]/g)].map((match) => match[2])
    expect(modes).toEqual(['First invitation', 'Second reminder', 'Final reminder'])
  })
})
