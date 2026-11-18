import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ADMIN_FILTERS_REPORT_STATEMENT_NAMES, adminFiltersReportStatements } from './admin-filters-report-sql'

/**
 * Round GP: the read-only counts runner reads scripts/aws/admin-filters-report.sql.json, a committed copy of these
 * statements (the host runs Python, not this app). This keeps the copy equal to the module.
 * UPDATE_ADMIN_FILTERS_REPORT_SQL=1 npx vitest run src/features/countries/admin-filters-report-sql.test.ts rewrites it.
 */
const PATH = 'scripts/aws/admin-filters-report.sql.json'

describe('admin filters report SQL', () => {
  const statements = adminFiltersReportStatements()
  const generated = `${JSON.stringify(statements, null, 2)}\n`

  it('the committed copy the runner reads equals the module', () => {
    if (process.env.UPDATE_ADMIN_FILTERS_REPORT_SQL === '1') writeFileSync(PATH, generated)
    expect(existsSync(PATH)).toBe(true)
    expect(readFileSync(PATH, 'utf8')).toBe(generated)
  })

  it('every statement is one read (select or with), with no parameters or writes', () => {
    expect(Object.keys(statements)).toEqual([...ADMIN_FILTERS_REPORT_STATEMENT_NAMES])
    for (const [name, sql] of Object.entries(statements)) {
      expect(sql, name).toMatch(/^\s*(select|with)\b/i)
      expect(sql, name).not.toMatch(/\$[0-9]/)
      expect(sql, name).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create|grant|copy|call|do)\s/i)
      expect(sql, name).not.toMatch(/;\s*\S/)
      // What comes out (counts and codes only) is checked against real rows in admin-country.integration.test.ts.
    }
  })
})
