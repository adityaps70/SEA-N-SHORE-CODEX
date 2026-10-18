import { describe, expect, it } from 'vitest'
import { applicantRangeLabel } from './applicant-range'
import { companyLocationSentence, locationKind } from './job-location'

describe('companyLocationSentence (Round H, H7)', () => {
  it('says "Remote employer" instead of "Employer based in Remote"', () => {
    expect(companyLocationSentence('Remote')).toBe('Remote employer')
    expect(companyLocationSentence(' remote ')).toBe('Remote employer')
    expect(companyLocationSentence('Work from home')).toBe('Remote employer')
  })

  it('words worldwide and onboard locations naturally', () => {
    expect(companyLocationSentence('Worldwide')).toBe('Employer operating worldwide')
    expect(companyLocationSentence('Global')).toBe('Employer operating worldwide')
    expect(companyLocationSentence('Onboard')).toBe('Sea-based employer')
    expect(companyLocationSentence('At sea')).toBe('Sea-based employer')
  })

  it('names a real place, and nothing for a blank location', () => {
    expect(companyLocationSentence('Dubai, United Arab Emirates')).toBe('Employer based in Dubai, United Arab Emirates')
    expect(companyLocationSentence('Andheri East, Mumbai')).toBe('Employer based in Andheri East, Mumbai')
    expect(companyLocationSentence('  ')).toBeNull()
    expect(companyLocationSentence(null)).toBeNull()
  })

  it('classifies location text', () => {
    expect(locationKind('Remote.')).toBe('remote')
    expect(locationKind('World wide')).toBe('worldwide')
    expect(locationKind('On board')).toBe('onboard')
    expect(locationKind('Remote Island Port')).toBe('place')
    expect(locationKind('')).toBeNull()
  })
})

describe('applicantRangeLabel (Round H, H7)', () => {
  it('turns the count into a public range', () => {
    expect(applicantRangeLabel(0)).toBe('Be among the first applicants')
    expect(applicantRangeLabel(1)).toBe('Fewer than 10 applicants')
    expect(applicantRangeLabel(9)).toBe('Fewer than 10 applicants')
    expect(applicantRangeLabel(10)).toBe('10–25 applicants')
    expect(applicantRangeLabel(24)).toBe('10–25 applicants')
    expect(applicantRangeLabel(25)).toBe('25–50 applicants')
    expect(applicantRangeLabel(49)).toBe('25–50 applicants')
    expect(applicantRangeLabel(50)).toBe('50–100 applicants')
    expect(applicantRangeLabel(99)).toBe('50–100 applicants')
    expect(applicantRangeLabel(100)).toBe('100+ applicants')
    expect(applicantRangeLabel(4000)).toBe('100+ applicants')
  })

  it('treats bad input as no applicants', () => {
    expect(applicantRangeLabel(-3)).toBe('Be among the first applicants')
    expect(applicantRangeLabel(Number.NaN)).toBe('Be among the first applicants')
  })
})
