import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { finalReminderExclusionSql } from './final-reminder-repository'
import { SHADOW_SQL_HEADER, shadowComparisonSql } from './final-reminder-previous-sql.fixture'

const FILE = 'scripts/aws/round-db-final-reminder-shadow.sql'

describe('the live shadow comparison statement (Round DB, Deploy B)', () => {
  it('is generated from the app’s current rule and the frozen previous rule, and selects reason names and counts only', () => {
    const expected = `${SHADOW_SQL_HEADER}${shadowComparisonSql(finalReminderExclusionSql(true))}\n`
    if (process.env.UPDATE_SHADOW_SQL === '1') writeFileSync(FILE, expected)
    // Run with UPDATE_SHADOW_SQL=1 to regenerate after a deliberate change to the rule.
    expect(readFileSync(FILE, 'utf8')).toBe(expected)
    expect(expected).toMatch(/^select previous\.reason as previous_reason, current_rule\.reason as current_reason, count\(\*\)::int as n\nfrom \($/m)
    expect(expected).not.toMatch(/\$\d/)
  })
})
