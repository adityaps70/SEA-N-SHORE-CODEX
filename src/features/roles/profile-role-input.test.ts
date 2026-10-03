import { describe, expect, it } from 'vitest'
import { applyProfileRoleFields, parseProfileRoleFields } from './profile-role-input'

function form(values: Record<string, string>) {
  const data = new FormData()
  data.set('roleFields', '1')
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

describe('structured profile role fields', () => {
  it('requires a seafarer rank and saves its keys with the label as the rank text', () => {
    expect(parseProfileRoleFields({}, 'seafarer')).toEqual({ ok: false, fieldErrors: { roleKey: ['Choose your current or most recent rank.'] } })
    const parsed = parseProfileRoleFields({ roleDepartmentKey: 'deck_officers', roleKey: 'master' }, 'seafarer')
    expect(parsed).toMatchObject({ ok: true, rankText: 'Master / Captain', data: { roleDepartmentKey: 'deck_officers', roleKey: 'master', roleOtherText: null } })
  })

  it('rejects unknown keys and ranks from another department or persona', () => {
    expect(parseProfileRoleFields({ roleDepartmentKey: 'deck_officers', roleKey: 'captain_america' }, 'seafarer').ok).toBe(false)
    expect(parseProfileRoleFields({ roleDepartmentKey: 'deck_officers', roleKey: 'cook' }, 'seafarer').ok).toBe(false)
    expect(parseProfileRoleFields({ roleDepartmentKey: 'technical_fleet', roleKey: 'fleet_manager' }, 'seafarer')).toMatchObject({ ok: false, fieldErrors: { roleDepartmentKey: expect.any(Array) } })
  })

  it('needs the typed text for "Other" and shows it as typed', () => {
    expect(parseProfileRoleFields({ roleDepartmentKey: 'deck_officers', roleKey: 'other_deck_officers' }, 'seafarer'))
      .toEqual({ ok: false, fieldErrors: { roleOtherText: ['Type your rank.'] } })
    expect(parseProfileRoleFields({ roleDepartmentKey: 'deck_officers', roleKey: 'other_deck_officers', roleOtherText: ' Ice  Navigator ' }, 'seafarer'))
      .toMatchObject({ ok: true, rankText: 'Ice Navigator', data: { roleOtherText: 'Ice Navigator' } })
  })

  it('keeps the role optional for shore professionals', () => {
    expect(parseProfileRoleFields({}, 'shore_professional')).toMatchObject({ ok: true, rankText: null, data: { roleKey: null } })
    expect(parseProfileRoleFields({ roleDepartmentKey: 'technical_fleet', roleKey: 'technical_superintendent' }, 'shore_professional'))
      .toMatchObject({ ok: true, rankText: 'Technical Superintendent' })
  })

  it('requires a cadet stage and a target job role', () => {
    expect(parseProfileRoleFields({}, 'student_cadet')).toEqual({ ok: false, fieldErrors: { cadetStageKey: ['Choose your current stage.'] } })
    expect(parseProfileRoleFields({ cadetStageKey: 'deck_cadet' }, 'student_cadet'))
      .toEqual({ ok: false, fieldErrors: { targetRoleKey: ['Choose the job role you are working towards.'] } })
    expect(parseProfileRoleFields({ cadetStageKey: 'deck_cadet', cadetCourseKey: 'dns', targetDepartmentKey: 'deck_officers', targetRoleKey: 'third_officer' }, 'student_cadet'))
      .toMatchObject({ ok: true, rankText: null, data: { cadetStageKey: 'deck_cadet', cadetCourseKey: null, targetRoleKey: 'third_officer', roleKey: null } })
  })

  it('gives enthusiasts only an occupation, never a rank', () => {
    expect(parseProfileRoleFields({ occupationText: 'Web developer', roleDepartmentKey: 'deck_officers', roleKey: 'master' }, 'maritime_enthusiast'))
      .toMatchObject({ ok: true, rankText: null, data: { occupationText: 'Web developer', roleKey: null, roleDepartmentKey: null } })
  })

  it('puts the picked rank label in the submitted rank text', () => {
    const applied = applyProfileRoleFields(form({ roleDepartmentKey: 'deck_officers', roleKey: 'chief_officer', rank: 'spoofed' }), 'seafarer')
    expect(applied.ok && applied.formData.get('rank')).toBe('Chief Officer')
  })

  it('leaves the saved rank text alone when no role is picked, and clears it on request', () => {
    const kept = applyProfileRoleFields(form({ rank: 'Captain' }), 'shore_professional')
    expect(kept.ok && kept.formData.has('rank')).toBe(false)
    const cleared = applyProfileRoleFields(form({ clearRank: 'on' }), 'maritime_enthusiast')
    expect(cleared.ok && cleared.formData.get('rank')).toBe('')
  })

  it('ignores forms without the role fields', () => {
    const data = new FormData()
    data.set('rank', 'Master')
    const applied = applyProfileRoleFields(data, 'seafarer')
    expect(applied).toEqual({ ok: true, formData: data, role: null })
  })
})
