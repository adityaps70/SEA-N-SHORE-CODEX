import { describe, expect, it } from 'vitest'
import { displayableVisas, isPlaceholderVisa, jobVisaNote } from './visa-display'

describe('visa display (hotfix P5)', () => {
  it('treats "N/A"-style and empty values as no visa, in any case or spacing', () => {
    for (const value of ['N/A', 'n/a', ' N / A ', 'NA', 'na', 'N.A.', 'None', 'NONE', 'nil', 'Nil', '-', '--', ' - ', 'not applicable', 'Not  Applicable', 'NOT APPLICABLE', '', '   ', null, undefined]) {
      expect(isPlaceholderVisa(value), String(value)).toBe(true)
    }
    for (const value of ['US C1/D', 'B1/B2', 'Schengen', 'UK Transit', 'Australian MCV', 'Nigeria', 'Nauru', 'Canada']) {
      expect(isPlaceholderVisa(value), value).toBe(false)
    }
  })

  it('shows only real values, trimmed and once each', () => {
    expect(displayableVisas(['N/A', ' US C1/D ', 'none', 'us c1/d', '-', 'Schengen'])).toEqual(['US C1/D', 'Schengen'])
    expect(displayableVisas(['NA', 'nil', 'Not applicable'])).toEqual([])
  })

  it('a job note lists every visa it gives (required or preferred), without placeholders', () => {
    expect(jobVisaNote({ visaRequirements: ['N/A'], visaList: [{ name: 'N/A' }, { name: 'Schengen' }] })).toEqual(['Schengen'])
    expect(jobVisaNote({ visaRequirements: ['US C1/D', 'N/A'] })).toEqual(['US C1/D'])
    expect(jobVisaNote({ visaRequirements: ['N/A'], visaList: [{ name: 'n/a' }] })).toEqual([])
  })
})
