import test from 'node:test'
import assert from 'node:assert/strict'
import { profilePreferencesSchema, profilePreferenceProjection } from './profile-preferences'

test('profile preferences keep persona and intents as the canonical member identity', () => {
  const parsed = profilePreferencesSchema.parse({
    persona: 'trainer_instructor',
    profileIntents: JSON.stringify(['teach', 'learn', 'teach']),
    currentCompany: 'Beaufort Marine',
    specialization: 'SIRE 2.0',
    institutionName: 'ignored',
    familyRelationship: 'ignored',
    rank: 'ignored',
  })

  assert.deepEqual(parsed.profileIntents, ['teach', 'learn'])
  assert.equal(parsed.specialization, 'SIRE 2.0')
  assert.equal(parsed.currentCompany, 'Beaufort Marine')
  assert.equal(parsed.institutionName, undefined)
  assert.equal(parsed.familyRelationship, undefined)
  assert.equal(parsed.rank, undefined)

  const projection = profilePreferenceProjection(parsed)
  assert.equal(projection.profileType, 'trainer')
  assert.equal(projection.communityRelationship, null)
  assert.equal(projection.institutionName, null)
  assert.equal(projection.specialization, 'SIRE 2.0')
})

test('profile preferences require at least one intent', () => {
  const parsed = profilePreferencesSchema.safeParse({
    persona: 'maritime_enthusiast',
    profileIntents: '[]',
  })
  assert.equal(parsed.success, false)
})
