import type { JobCandidateProfile, JobListing } from '@/features/jobs/types'

/**
 * Hotfix P5: five sample jobs and one member for the visa-free match snapshot. Two jobs list visas
 * (one "N/A", one real), so the snapshot shows those score as if no visa were listed, and the other
 * three keep the scores they had before visa left matching.
 */
export const VISA_SNAPSHOT_TODAY = new Date('2026-10-30T06:00:00.000Z')

function job(id: string, overrides: Partial<JobListing>): JobListing {
  return {
    id, title: 'Sample role', companyName: 'Sample Lines', companyId: null, companySlug: null, companyVerified: false,
    recruiterVerified: false, location: null, summary: '', description: '', requirements: null, applyUntil: null,
    createdAt: '2026-10-28T00:00:00.000Z', publishedAt: '2026-10-28T00:00:00.000Z', domain: 'sea', department: null, rank: null,
    departmentKey: 'deck_officers', acceptedRoleKeys: [], vesselTypes: [], experienceMinYears: null, experienceMaxYears: null,
    joiningFrom: null, joiningUntil: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null, regions: [],
    certificateRequirements: [], visaRequirements: [], urgent: false, easyApply: true, ...overrides,
  }
}

export const VISA_SNAPSHOT_JOBS: JobListing[] = [
  job('rank-vessel-region', { acceptedRoleKeys: ['second_officer'], vesselTypes: ['Product Tanker'], regions: ['Middle East'] }),
  job('na-visa', {
    acceptedRoleKeys: ['second_officer'], vesselTypes: ['Product Tanker'], experienceMinYears: 4,
    visaRequirements: ['N/A'], visaList: [{ name: 'N/A', required: true }],
  }),
  job('us-visa', {
    acceptedRoleKeys: ['chief_officer'], vesselTypes: ['LNG Carrier'], certificateRequirements: ['ECDIS'],
    certificateList: [{ name: 'ECDIS', code: null, required: true }],
    visaRequirements: ['US C1/D'], visaList: [{ name: 'US C1/D', required: true }, { name: 'Schengen', required: false }],
  }),
  job('certificates-sea-time', {
    acceptedRoleKeys: ['second_officer'], experienceMinYears: 8, certificateRequirements: ['ECDIS', 'Advanced Oil Tanker'],
    certificateList: [{ name: 'ECDIS', code: null, required: true }, { name: 'Advanced Oil Tanker', code: null, required: true }],
  }),
  job('shore', {
    domain: 'shore', departmentKey: null, title: 'Marine Superintendent', requirements: 'Tanker vetting and SIRE inspections',
    location: 'Mumbai, India', experienceMinYears: 5,
  }),
]

export const VISA_SNAPSHOT_MEMBER: JobCandidateProfile = {
  persona: 'seafarer', roleKey: 'second_officer', rank: null, sailingExperienceYears: 6, vesselTypes: ['Product Tanker'],
  tradingAreas: ['Middle East'], availability: null, location: 'Mumbai, India',
  certificates: [{ name: 'ECDIS', expiresAt: null, verified: true }], visas: ['B1/B2'], shoreCareerPreference: false,
  skills: ['Vetting', 'SIRE'], experiences: [],
}
