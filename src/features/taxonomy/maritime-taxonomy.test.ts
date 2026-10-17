import { describe, expect, it } from 'vitest'
import {
  CERTIFICATE_TYPE_SEEDS,
  MARITIME_RANKS,
  VESSEL_TYPE_SEEDS,
  matchCertificateType,
  matchRank,
  matchVesselType,
  rankDepartmentGroup,
  rankDistance,
  vesselGroupOf,
  vesselTypeCodes,
} from './maritime-taxonomy'

describe('maritime taxonomy', () => {
  it('covers the ranks the owner listed, by synonym, case, dot and space insensitive', () => {
    const cases: Array<[string, string]> = [
      ['Master', 'master'], ['C/O', 'chief_officer'], ['Chief Mate', 'chief_officer'], ['2/O', 'second_officer'],
      ['second officer', 'second_officer'], ['2nd Mate', 'second_officer'], ['3rd Officer', 'third_officer'],
      ['Junior Officer', 'junior_deck_officer'], ['Deck Cadet', 'deck_cadet'], ['Bosun', 'bosun'], ['AB', 'able_seaman'],
      ['OS', 'ordinary_seaman'], ['Pumpman', 'pumpman'], ['C/E', 'chief_engineer'], ['2nd Engineer', 'second_engineer'],
      ['3rd engineer', 'third_engineer'], ['4th Engineer', 'fourth_engineer'], ['Junior Engineer', 'junior_engineer'],
      ['TME', 'engine_cadet'], ['ETO', 'eto'], ['Electrical Officer', 'electrical_officer'], ['Electro Technical Rating', 'electrician'],
      ['Fitter', 'fitter'], ['Motorman', 'motorman'], ['Oiler', 'oiler'], ['Wiper', 'wiper'], ['Chief Cook', 'chief_cook'],
      ['Cook', 'cook'], ['Messman', 'messman'], ['Steward', 'steward'], ['Technical Superintendent', 'technical_superintendent'],
      ['Marine Manager', 'marine_superintendent'], ['Crewing Manager', 'crewing_manager'], ['Port Captain', 'port_captain'],
      ['DPA', 'dpa'], ['CSO', 'cso'], ['Marine Surveyor', 'marine_surveyor'], ['Vetting Inspector', 'vetting_manager'],
      ['Ship Broker', 'chartering_manager'], ['Operations Manager', 'operations_manager'], ['Shipping Agent', 'shipping_agent'],
      ['Lecturer', 'senior_faculty'],
    ]
    for (const [text, code] of cases) expect([text, matchRank(text)]).toEqual([text, code])
  })

  it('groups ranks by department and measures ladder steps without direction', () => {
    expect(rankDepartmentGroup('second_officer')).toBe('deck')
    expect(rankDepartmentGroup('third_engineer')).toBe('engine')
    expect(rankDepartmentGroup('eto')).toBe('electrical')
    expect(rankDepartmentGroup('chief_cook')).toBe('catering')
    expect(rankDepartmentGroup('crewing_manager')).toBe('shore')
    expect(rankDistance('second_officer', 'chief_officer')).toBe(1)
    expect(rankDistance('chief_officer', 'second_officer')).toBe(1)
    expect(rankDistance('master', 'third_officer')).toBe(3)
    expect(rankDistance('second_officer', 'second_engineer')).toBeNull()
    expect(rankDistance('second_officer', 'unknown')).toBeNull()
    // Round H: the ranks added in 0089.
    expect(rankDepartmentGroup('mooring_master')).toBe('deck')
    expect(rankDepartmentGroup('ship_chandler')).toBe('shore')
    expect(matchRank('Ship Chandler')).toBe('ship_chandler')
    expect(matchRank('ops coordinator')).toBe('operations_coordinator')
    // Marine Manager stays a synonym of Marine Superintendent, not a rank of its own.
    expect(MARITIME_RANKS.some((rank) => rank.code === 'marine_manager')).toBe(false)
  })

  it('maps vessel types and certificates from free text', () => {
    expect(matchVesselType('VLCC')).toBe('crude_tanker')
    expect(matchVesselType('lng')).toBe('lng_carrier')
    expect(matchVesselType('Ro-Ro')).toBe('ro_ro')
    expect(matchVesselType('Containership')).toBe('container')
    expect(matchVesselType('Spaceship')).toBeNull()
    expect(vesselGroupOf('lpg_carrier')).toBe('gas')
    expect(vesselTypeCodes(['Oil Tanker', 'oil tanker', 'AHTS', 'Unknown'])).toEqual(['oil_tanker', 'ahts'])
    expect(matchCertificateType('Advanced Fire-Fighting')).toBe('aff')
    expect(matchCertificateType('GMDSS GOC')).toBe('gmdss')
    expect(matchCertificateType('MEO Class 1')).toBe('coc_chief_engineer')
    expect(matchCertificateType('Medical Certificate')).toBe('medical_fitness')
  })

  it('has unique codes and no term that maps to two codes', () => {
    for (const list of [MARITIME_RANKS, VESSEL_TYPE_SEEDS, CERTIFICATE_TYPE_SEEDS]) {
      const codes = list.map((entry) => entry.code)
      expect(new Set(codes).size).toBe(codes.length)
    }
    for (const certificate of CERTIFICATE_TYPE_SEEDS) {
      if (certificate.cocRankCode) expect(MARITIME_RANKS.some((rank) => rank.code === certificate.cocRankCode)).toBe(true)
    }
  })
})
