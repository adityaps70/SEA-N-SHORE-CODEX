import { describe, expect, it } from 'vitest'
import { buildImportPlan, normalizeEmail } from './beaufortmarine-import.mjs'

const empty = {
  table_address: [], table_seafearer: [], table_consultant: [], table_shore_staff: [],
  table_company: [], table_seafearer_experience: [], table_seafearer_certificate: [],
  table_seafearer_courses: [], table_consultant_qualification: [],
}

describe('Beaufort legacy import', () => {
  it('accepts valid emails and rejects malformed ones', () => {
    expect(normalizeEmail(' Member@Example.com ')).toBe('member@example.com')
    expect(normalizeEmail('not-an-email')).toBeNull()
  })

  it('merges duplicate legacy roles by email and excludes legacy-only data', () => {
    const tables = structuredClone(empty)
    tables.table_seafearer.push({
      tlid: 1, status: 1, name: 'Captain One', email: 'captain@example.net', rank: 'Master',
      summery: 'Master mariner', total_experience: 15, com_addressid: 10,
    })
    tables.table_consultant.push({
      tlid: 2, status: 1, name: 'Captain One', email: 'CAPTAIN@example.net',
      designation: 'Marine Consultant', summery: 'Consulting', total_experience: 12, addressid: 10,
    })
    tables.table_address.push({ tlid: 10, city: 'Mumbai', state: 'Maharashtra', country: 'India' })
    tables.table_seafearer_experience.push({
      tlid: 3, status: 1, seafearerid: 1, rank: 'Master', company: 'Ocean Shipping',
      type_of_ship: 'Oil Tanker', joining_date: '2020-01-01', leaving_date: '2021-01-01',
    })
    tables.table_seafearer_certificate.push({
      tlid: 4, status: 1, seafearerid: 1, certificate_type: 'Certificate of Competency',
      type: 'Master', certificate_no: 'COC123', authority: 'DG Shipping', expiry: '2030-01-01 00:00:00',
    })
    tables.table_seafearer_courses.push({
      tlid: 6, status: 1, seafearerid: 1, pssr_no: 'PSSR-1', pssr_inst: 'Maritime Academy',
    })
    tables.table_consultant_qualification.push({
      tlid: 5, status: 1, consultantid: 2, internal_audit: 'yes', lead_auditor: 'yes',
    })

    const plan = buildImportPlan(tables)
    expect(plan.people).toHaveLength(1)
    expect(plan.audit.duplicateEmailGroups).toBe(1)
    expect(plan.people[0]).toMatchObject({
      email: 'captain@example.net', persona: 'seafarer', rank: 'Master',
      company: 'Ocean Shipping', vesselTypes: ['Oil Tanker'],
    })
    expect(plan.people[0].skills).toEqual(expect.arrayContaining(['Internal Auditor', 'Lead Auditor']))
    expect(plan.people[0].credentials).toHaveLength(2)
    expect(plan.people[0]).not.toHaveProperty('membership')
    expect(plan.people[0]).not.toHaveProperty('jobApplications')
  })

  it('keeps legacy experience while dropping invalid reversed end dates and sanitizing summary text', () => {
    const tables = structuredClone(empty)
    tables.table_seafearer.push({
      tlid: 10,
      status: 1,
      name: 'Captain Legacy',
      email: 'legacy@example.net',
      rank: 'Master',
      summery: 'A'.repeat(1900) + '\u0007' + 'B'.repeat(400),
      total_experience: 20,
    })
    tables.table_seafearer_experience.push({
      tlid: 11,
      status: 1,
      seafearerid: 10,
      rank: 'Master',
      company: 'Legacy Shipping',
      type_of_ship: 'Bulk Carrier',
      joining_date: '2022-06-01',
      leaving_date: '2021-06-01',
    })

    const plan = buildImportPlan(tables)
    expect(plan.people).toHaveLength(1)
    expect(Array.from(plan.people[0].summary ?? '')).toHaveLength(1800)
    expect(plan.people[0].summary).not.toContain('\u0007')
    expect(plan.people[0].experiences[0]).toMatchObject({
      start: '2022-06-01',
      end: null,
    })
  })

  it('holds invalid emails and obvious test accounts out of automatic import', () => {
    const tables = structuredClone(empty)
    tables.table_shore_staff.push(
      { tlid: 1, status: 1, name: 'Bad Email', email: 'wrong' },
      { tlid: 2, status: 1, name: 'Test Account', email: 'test-user@example.net' },
    )
    const plan = buildImportPlan(tables)
    expect(plan.people).toHaveLength(0)
    expect(plan.audit.invalidEmailRows).toBe(1)
    expect(plan.audit.testRows).toBe(1)
  })
})
