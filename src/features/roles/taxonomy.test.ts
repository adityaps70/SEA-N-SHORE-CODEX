import { describe, expect, it } from 'vitest'
import { PERSONAS } from '@/features/profiles/persona'
import {
  OTHER_ROLE_LABEL,
  ROLES,
  ROLE_DEPARTMENTS,
  acceptedRolesLabel,
  cadetStageRoleKey,
  defaultTargetRoleFor,
  departmentsFor,
  isSeaDepartment,
  ladderDistance,
  normaliseLegacyRank,
  roleByKey,
  roleDisplayLabel,
  rolesFor,
  sameDepartment,
} from './taxonomy'

const keysOf = (entries: readonly { key: string }[]) => entries.map((entry) => entry.key)

describe('role taxonomy', () => {
  it('has unique snake_case keys for every department and role', () => {
    const roleKeys = keysOf(ROLES)
    const departmentKeys = keysOf(ROLE_DEPARTMENTS)
    expect(new Set(roleKeys).size).toBe(roleKeys.length)
    expect(new Set(departmentKeys).size).toBe(departmentKeys.length)
    for (const key of [...roleKeys, ...departmentKeys]) expect(key).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('ends every department list with "Other (type your own)"', () => {
    for (const department of ROLE_DEPARTMENTS) {
      const roles = rolesFor(department.key)
      expect(roles.length).toBeGreaterThan(1)
      const last = roles[roles.length - 1]
      expect(last.label).toBe(OTHER_ROLE_LABEL)
      expect(last.key).toBe(`other_${department.key}`)
      expect(last.other).toBe(true)
    }
  })

  it('gives each persona the right departments', () => {
    expect(keysOf(departmentsFor('seafarer'))).toEqual([
      'deck_officers', 'deck_ratings', 'engine_officers', 'engine_ratings', 'catering', 'specialist_offshore',
    ])
    expect(keysOf(departmentsFor('shore_professional'))).toEqual([
      'technical_fleet', 'hseq_vetting', 'operations_commercial', 'crewing_manning',
      'port_terminal_logistics', 'survey_class_legal_insurance', 'shipyard_engineering', 'management',
    ])
    expect(keysOf(departmentsFor('recruiter_hr'))).toEqual(['recruitment_hr'])
    expect(keysOf(departmentsFor('trainer_instructor'))).toEqual(['training'])
    expect(keysOf(departmentsFor('student_cadet'))).toEqual([
      ...keysOf(departmentsFor('seafarer')),
      ...keysOf(departmentsFor('shore_professional')),
    ])
    for (const persona of ['seafarer_family', 'maritime_enthusiast', 'other'] as const) {
      expect(departmentsFor(persona)).toEqual([])
    }
    expect(PERSONAS).toHaveLength(8)
  })

  it('lists the deck officer ranks in order of seniority', () => {
    expect(rolesFor('deck_officers').map((role) => role.label)).toEqual([
      'Master / Captain',
      'Chief Officer',
      'Second Officer',
      'Third Officer',
      'Junior Officer / Fourth Officer',
      'Deck Cadet / Trainee Officer',
      OTHER_ROLE_LABEL,
    ])
    expect(isSeaDepartment('deck_officers')).toBe(true)
    expect(isSeaDepartment('technical_fleet')).toBe(false)
  })

  it('maps old free-text ranks to keys', () => {
    expect(normaliseLegacyRank('Captain')).toBe('master')
    expect(normaliseLegacyRank('Master Mariner')).toBe('master')
    expect(normaliseLegacyRank('  MASTER ')).toBe('master')
    expect(normaliseLegacyRank('Master / Captain')).toBe('master')
    expect(normaliseLegacyRank('C/O')).toBe('chief_officer')
    expect(normaliseLegacyRank('chief mate')).toBe('chief_officer')
    expect(normaliseLegacyRank('2nd Engineer')).toBe('second_engineer')
    expect(normaliseLegacyRank('2/E')).toBe('second_engineer')
    expect(normaliseLegacyRank('3rd Mate')).toBe('third_officer')
    expect(normaliseLegacyRank('Able Seaman')).toBe('able_seaman')
    expect(normaliseLegacyRank('AB')).toBe('able_seaman')
    expect(normaliseLegacyRank('ETO')).toBe('eto')
    expect(normaliseLegacyRank('Chief Cook')).toBe('chief_cook')
    expect(normaliseLegacyRank('Designated Person Ashore (DPA)')).toBe('dpa')
    expect(normaliseLegacyRank('Marine Pilot')).toBe('marine_pilot')
  })

  it('returns null for text it does not recognise', () => {
    expect(normaliseLegacyRank('Web developer')).toBeNull()
    expect(normaliseLegacyRank('')).toBeNull()
    expect(normaliseLegacyRank(null)).toBeNull()
    expect(normaliseLegacyRank('Other (type your own)')).toBeNull()
  })

  it('measures ladder distance only on the same ladder', () => {
    expect(ladderDistance('chief_officer', 'master')).toBe(1)
    expect(ladderDistance('master', 'chief_officer')).toBe(-1)
    expect(ladderDistance('master', 'master')).toBe(0)
    expect(ladderDistance('second_officer', 'master')).toBe(2)
    expect(ladderDistance('cook', 'master')).toBeNull()
    expect(ladderDistance('bosun', 'third_officer')).toBeNull()
    expect(ladderDistance('eto', 'second_engineer')).toBeNull()
    expect(ladderDistance('other_deck_officers', 'master')).toBeNull()
    expect(ladderDistance('hr_crewing_manager', 'crewing_manager')).toBe(0)
  })

  it('compares departments through the shared entries', () => {
    expect(sameDepartment('master', 'third_officer')).toBe(true)
    expect(sameDepartment('master', 'bosun')).toBe(false)
    expect(sameDepartment('hr_crew_coordinator', 'crewing_manager')).toBe(true)
  })

  it('suggests a target role from the cadet stage', () => {
    expect(defaultTargetRoleFor('deck_cadet')).toBe('third_officer')
    expect(defaultTargetRoleFor('engine_cadet')).toBe('fourth_engineer')
    expect(defaultTargetRoleFor('eto_cadet')).toBe('eto')
    expect(defaultTargetRoleFor('trainee_rating')).toBe('ordinary_seaman')
    expect(defaultTargetRoleFor('pre_sea', 'gp_rating')).toBe('ordinary_seaman')
    expect(defaultTargetRoleFor('coc_exam')).toBeNull()
    expect(cadetStageRoleKey('deck_cadet')).toBe('deck_cadet')
    for (const key of ['third_officer', 'fourth_engineer', 'eto', 'ordinary_seaman', 'deck_cadet', 'engine_cadet', 'messman']) {
      expect(roleByKey(key)).toBeDefined()
    }
  })

  it('shows the label, the typed Other text, or the old text', () => {
    expect(roleDisplayLabel({ roleKey: 'master', legacyText: 'Capt.' })).toBe('Master / Captain')
    expect(roleDisplayLabel({ roleKey: 'other_deck_officers', otherText: 'Ice Navigator' })).toBe('Ice Navigator')
    expect(roleDisplayLabel({ roleKey: null, legacyText: 'Sea captain' })).toBe('Sea captain')
    expect(roleDisplayLabel({})).toBeNull()
    expect(acceptedRolesLabel(['master', 'chief_officer'])).toBe('Master / Captain, Chief Officer')
  })
})

describe('rank selection banner', () => {
  it('asks seafarers and cadets without a key, and members whose old rank text is not recognised', async () => {
    const { profileNeedsRankSelection } = await import('./taxonomy')
    expect(profileNeedsRankSelection({ persona: 'seafarer', roleKey: null, rank: 'Captain' })).toBe(true)
    expect(profileNeedsRankSelection({ persona: 'seafarer', roleKey: 'master' })).toBe(false)
    expect(profileNeedsRankSelection({ persona: 'student_cadet', targetRoleKey: null })).toBe(true)
    expect(profileNeedsRankSelection({ persona: 'shore_professional', rank: 'Chief Wizard' })).toBe(true)
    expect(profileNeedsRankSelection({ persona: 'shore_professional', rank: 'Fleet Manager' })).toBe(false)
    expect(profileNeedsRankSelection({ persona: 'shore_professional', rank: null })).toBe(false)
    expect(profileNeedsRankSelection({ persona: 'maritime_enthusiast', rank: 'Captain' })).toBe(false)
    expect(profileNeedsRankSelection({ persona: null, profileType: 'seafarer', roleKey: null })).toBe(true)
    expect(profileNeedsRankSelection({ persona: 'seafarer', identityRoot: 'organisation' })).toBe(false)
  })
})
