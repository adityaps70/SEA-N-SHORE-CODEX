import { describe, expect, it } from 'vitest'
import { JOB_DISCOVERY_MODES, SEA_RANKS, SHORE_ROLES, VESSEL_TYPES } from './catalog'

describe('maritime jobs catalog', () => {
  it('keeps candidate discovery modes explicit and maritime-specific', () => {
    expect(JOB_DISCOVERY_MODES.map((mode) => mode.value)).toEqual(['for-you', 'sea', 'shore', 'urgent', 'recent'])
  })

  it('contains representative sea ranks and shore roles without duplicates', () => {
    expect(SEA_RANKS).toContain('Master')
    expect(SEA_RANKS).toContain('Chief Officer')
    expect(SEA_RANKS).toContain('Chief Engineer')
    expect(SEA_RANKS).toContain('ETO')
    expect(SHORE_ROLES).toContain('Technical Superintendent')
    expect(SHORE_ROLES).toContain('Marine Superintendent')
    expect(SHORE_ROLES).toContain('Crewing Manager')
    expect(new Set(SEA_RANKS).size).toBe(SEA_RANKS.length)
    expect(new Set(SHORE_ROLES).size).toBe(SHORE_ROLES.length)
  })

  it('contains vessel types needed for tanker, gas, dry and offshore discovery', () => {
    for (const vessel of ['Oil Tanker', 'Chemical Tanker', 'LNG', 'LPG', 'Bulk Carrier', 'Container', 'AHTS', 'PSV']) {
      expect(VESSEL_TYPES).toContain(vessel)
    }
  })
})
