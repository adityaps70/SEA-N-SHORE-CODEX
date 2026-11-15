import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkAddRankInput, codeFor, positionFor } from './admin-ranks-repository'
import { addedRoleFromRow, createRoleCatalogLoader } from './catalog-server'
import { isAcceptableJobRoleKey } from './job-role-input'
import { parseProfileRoleFields } from './profile-role-input'
import {
  ROLES,
  allRoles,
  allRolesForPicker,
  departmentRoleKeys,
  jobDepartmentKeys,
  ladderDistance,
  ladderStep,
  normaliseLegacyRank,
  roleByKey,
  rolesFor,
  setAddedRoles,
  type RoleEntry,
} from './taxonomy'

/**
 * P6b (owner-approved 15 Nov): ranks administrators add join the live rank list everywhere: validation, pickers,
 * profiles, search and matching. Placeholder ranks only.
 */
const juniorEto: RoleEntry = {
  key: 'added_junior_eto', label: 'Junior ETO', department: 'engine_officers', ladder: 'electrical_officer', level: 2,
  position: 1.5, synonyms: ['Assistant ETO'], added: true, anchorKey: 'eto', anchorRelation: 'below',
}
const gpRating: RoleEntry = {
  key: 'added_gp_rating', label: 'GP Rating', department: 'deck_ratings', ladder: 'deck_rating', level: 3,
  position: 3, synonyms: ['General Purpose Rating'], added: true, anchorKey: 'able_seaman', anchorRelation: 'same',
}

afterEach(() => setAddedRoles([]))

describe('the live rank list (code list plus added ranks)', () => {
  it('without added ranks, every ladder distance is exactly the level difference it was before P6b', () => {
    const ranks = ROLES.filter((role) => !role.other && !role.sameAs)
    let compared = 0
    for (const a of ranks) {
      for (const b of ranks) {
        if (a.department !== b.department || a.ladder !== b.ladder) continue
        expect(ladderDistance(a.key, b.key), `${a.key} vs ${b.key}`).toBe(a.level - b.level)
        compared += 1
      }
    }
    expect(compared).toBeGreaterThan(100)
    expect(allRoles()).toEqual(ROLES)
  })

  it('an added rank shows in pickers next to its anchor, in search keys, labels and legacy text', () => {
    setAddedRoles([juniorEto, gpRating])
    expect(roleByKey('added_junior_eto')?.label).toBe('Junior ETO')
    const engine = rolesFor('engine_officers').map((role) => role.key)
    expect(engine.slice(engine.indexOf('eto'), engine.indexOf('eto') + 3)).toEqual(['eto', 'added_junior_eto', 'electrical_officer'])
    const deck = rolesFor('deck_ratings').map((role) => role.key)
    expect(deck[deck.indexOf('able_seaman') + 1]).toBe('added_gp_rating')
    expect(allRolesForPicker().map((role) => role.key)).toContain('added_gp_rating')
    expect(departmentRoleKeys(['engine_officers'])).toContain('added_junior_eto')
    expect(jobDepartmentKeys({ departmentKey: 'hseq_vetting', acceptedRoleKeys: ['added_junior_eto'] })).toEqual(['hseq_vetting', 'engine_officers'])
    expect(normaliseLegacyRank('assistant eto')).toBe('added_junior_eto')
    expect(normaliseLegacyRank('Chief Engineer')).toBe('chief_engineer')
  })

  it('matching counts an added rank as the step between its neighbours, and same-level ranks as equals', () => {
    setAddedRoles([juniorEto, gpRating])
    expect(ladderStep('eto')).toBe(1)
    expect(ladderStep('added_junior_eto')).toBe(2)
    expect(ladderStep('electrical_officer')).toBe(3)
    expect(ladderDistance('added_junior_eto', 'eto')).toBe(1)
    expect(ladderDistance('electrical_officer', 'eto')).toBe(2)
    expect(ladderDistance('added_gp_rating', 'able_seaman')).toBe(0)
    expect(ladderDistance('ordinary_seaman', 'bosun')).toBe(3)
    // Other ladders are unchanged.
    expect(ladderDistance('third_engineer', 'chief_engineer')).toBe(2)
  })

  it('job and profile validation accept an added rank at once', () => {
    expect(isAcceptableJobRoleKey('engine_officers', 'added_junior_eto')).toBe(false)
    setAddedRoles([juniorEto])
    expect(isAcceptableJobRoleKey('engine_officers', 'added_junior_eto')).toBe(true)
    expect(isAcceptableJobRoleKey('hseq_vetting', 'added_junior_eto')).toBe(true)
    const parsed = parseProfileRoleFields({ roleDepartmentKey: 'engine_officers', roleKey: 'added_junior_eto' }, 'seafarer')
    expect(parsed.ok).toBe(true)
  })

  it('a hidden added rank leaves the pickers but still resolves, validates and matches (jobs and profiles keep it)', () => {
    setAddedRoles([{ ...juniorEto, hidden: true }])
    expect(rolesFor('engine_officers').map((role) => role.key)).not.toContain('added_junior_eto')
    expect(rolesFor('engine_officers', ['added_junior_eto']).map((role) => role.key)).toContain('added_junior_eto')
    expect(allRolesForPicker().map((role) => role.key)).not.toContain('added_junior_eto')
    expect(roleByKey('added_junior_eto')?.label).toBe('Junior ETO')
    expect(isAcceptableJobRoleKey('engine_officers', 'added_junior_eto')).toBe(true)
    expect(ladderDistance('electrical_officer', 'eto')).toBe(2)
  })
})

describe('adding a rank: checks and placement', () => {
  it('refuses a name or other name that is already a rank (labels, bracket-less labels and synonyms)', () => {
    expect(checkAddRankInput({ label: 'Chief Mate', departmentKey: 'deck_officers', anchorKey: 'chief_officer', relation: 'below' })).toEqual({ ok: false, error: 'duplicate' })
    expect(checkAddRankInput({ label: 'Second Engineer', departmentKey: 'engine_officers', anchorKey: 'chief_engineer', relation: 'below' })).toEqual({ ok: false, error: 'duplicate' })
    expect(checkAddRankInput({ label: 'Reefer Engineer', departmentKey: 'engine_officers', anchorKey: 'third_engineer', relation: 'same', synonyms: ['ETO'] })).toEqual({ ok: false, error: 'duplicate' })
    const ok = checkAddRankInput({ label: '  GP  Rating ', departmentKey: 'deck_ratings', anchorKey: 'able_seaman', relation: 'same', synonyms: ['General Purpose Rating'] })
    expect(ok).toMatchObject({ ok: true, label: 'GP Rating', anchor: { key: 'able_seaman', ladder: 'deck_rating' } })
  })

  it('refuses an anchor from another department, "Other", unknown keys and bad names', () => {
    expect(checkAddRankInput({ label: 'Deck Fitter', departmentKey: 'deck_ratings', anchorKey: 'fitter', relation: 'same' })).toEqual({ ok: false, error: 'invalid_anchor' })
    expect(checkAddRankInput({ label: 'Deck Fitter', departmentKey: 'deck_ratings', anchorKey: 'other_deck_ratings', relation: 'same' })).toEqual({ ok: false, error: 'invalid_anchor' })
    expect(checkAddRankInput({ label: 'Deck Fitter', departmentKey: 'nope', anchorKey: 'bosun', relation: 'same' })).toEqual({ ok: false, error: 'invalid_department' })
    expect(checkAddRankInput({ label: 'x', departmentKey: 'deck_ratings', anchorKey: 'bosun', relation: 'same' })).toEqual({ ok: false, error: 'invalid_label' })
    expect(checkAddRankInput({ label: '1234', departmentKey: 'deck_ratings', anchorKey: 'bosun', relation: 'same' })).toEqual({ ok: false, error: 'invalid_label' })
  })

  it('places a rank between its neighbours, and refuses when there is no room left', () => {
    expect(positionFor(1, 'below', [1, 2, 3])).toBe(1.5)
    expect(positionFor(2, 'above', [1, 2, 3])).toBe(1.5)
    expect(positionFor(1, 'above', [1, 2, 3])).toBe(0)
    expect(positionFor(3, 'below', [1, 2, 3])).toBe(4)
    expect(positionFor(2, 'same', [1, 2, 3])).toBe(2)
    expect(positionFor(1, 'below', [1, 1.0001])).toBeNull()
    expect(codeFor('Junior ETO / Assistant')).toBe('added_junior_eto_assistant')
  })
})

describe('loading the added ranks', () => {
  const row = { code: 'added_junior_eto', name: 'Junior ETO', department_key: 'engine_officers', ladder: 'electrical_officer', ladder_level: 2, position: '1.5000', synonyms: ['Assistant ETO'], same_as: null, anchor_code: 'eto', anchor_relation: 'below', hidden_at: null }

  it('turns a database row into a rank and skips broken rows', () => {
    expect(addedRoleFromRow(row)).toMatchObject({ key: 'added_junior_eto', position: 1.5, anchorKey: 'eto', anchorRelation: 'below', added: true })
    expect(addedRoleFromRow({ ...row, hidden_at: new Date() })?.hidden).toBe(true)
    expect(addedRoleFromRow({ ...row, position: null })).toBeNull()
  })

  it('reloads at most every 30 seconds, keeps the last list when the database fails, and treats a missing schema as none', async () => {
    let now = 0
    const applied: RoleEntry[][] = []
    const query = vi.fn(async () => [row] as Array<Record<string, unknown>>)
    const warn = vi.fn()
    const loader = createRoleCatalogLoader({ query, apply: (entries) => applied.push(entries), now: () => now, warn })
    await loader.ensure()
    await loader.ensure()
    expect(query).toHaveBeenCalledTimes(1)
    now += 31_000
    query.mockRejectedValueOnce(new Error('down'))
    await loader.ensure()
    expect(applied).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith('[role_catalog_unavailable]', { stage: 'load' })
    query.mockRejectedValueOnce(Object.assign(new Error('column "source" does not exist'), { code: '42703' }))
    await loader.ensure()
    expect(applied.at(-1)).toEqual([])
    await loader.reload()
    expect(applied.at(-1)?.[0]?.key).toBe('added_junior_eto')
  })
})
