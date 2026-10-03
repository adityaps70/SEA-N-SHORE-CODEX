import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROLES, ROLE_DEPARTMENTS, departmentsFor, legacyRankEntries, roleByKey } from './taxonomy'

const sql = readFileSync('infra/aws/database/migrations/0062_structured_roles.sql', 'utf8')
const statements = sql.split(/^\s*-- statement-breakpoint\s*$/m).map((part) => part.trim()).filter(Boolean)

/** The rows of one `name(columns) as (values ...)` block. */
function valuesOf(statement: string, name: string): string[][] {
  const start = statement.indexOf(`${name}(`)
  expect(start, `${name} block`).toBeGreaterThanOrEqual(0)
  const body = statement.slice(statement.indexOf('values', start) + 'values'.length, statement.indexOf('\n)', start))
  return [...body.matchAll(/\(([^()]*)\)/g)].map((match) =>
    [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map((value) => value[1].replace(/''/g, "'")))
}

describe('migration 0062: structured roles (round 12)', () => {
  it('is non-destructive and split into the eleven statements the guarded script expects', () => {
    expect(statements).toHaveLength(11)
    expect(sql).not.toMatch(/drop\s+(table|column|type|schema|index)|truncate|delete\s+from/i)
  })

  it('backfills profiles and jobs from exactly the texts normaliseLegacyRank recognises', () => {
    const expected = legacyRankEntries().map(([text, key]) => [text, key, roleByKey(key)!.department])
    expect(valuesOf(statements[8], 'role_map')).toEqual(expected)
    expect(valuesOf(statements[9], 'role_map')).toEqual(expected)
  })

  it('resolves profile ranks inside the departments the persona picks from', () => {
    expect(valuesOf(statements[8], 'role_catalog')).toEqual(
      ROLES.filter((role) => !role.other).map((role) => [role.key, role.department, role.sameAs ?? role.key]))
    expect(valuesOf(statements[8], 'persona_departments')).toEqual(
      (['seafarer', 'shore_professional', 'recruiter_hr', 'trainer_instructor'] as const)
        .flatMap((persona) => departmentsFor(persona).map((department) => [persona, department.key])))
  })

  it('only gives a job a department of the same domain (sea / shore)', () => {
    expect(valuesOf(statements[9], 'department_domains')).toEqual(ROLE_DEPARTMENTS.map((department) => [department.key, department.domain]))
    expect(statements[9]).toContain("dd.domain = coalesce(j.job_domain, 'sea')")
  })

  it('turns the minimum off only for older shore jobs left without a department', () => {
    expect(statements[10]).toContain('set min_match_to_apply = 0')
    expect(statements[10]).toContain('where j.department_key is null')
    expect(statements[10]).toContain("coalesce(j.job_domain, 'sea') = 'shore'")
  })

  it('normalises old text the way normaliseRoleText does', () => {
    expect(statements[8]).toContain("btrim(regexp_replace(lower(replace(mp.rank, '&', ' and ')), '[^a-z0-9]+', ' ', 'g'))")
    expect(statements[9]).toContain("btrim(regexp_replace(lower(replace(j.rank, '&', ' and ')), '[^a-z0-9]+', ' ', 'g'))")
  })
})
