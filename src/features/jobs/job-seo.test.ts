import { describe, expect, it } from 'vitest'
import { countryCode, isJobId, jobLastDay, jobMetadata, jobPostingJsonLd, jobsIndexMetadata, postalAddress } from './job-seo'
import type { JobListing } from './types'

const ORIGIN = 'https://seanshore.example'

const base: JobListing = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Marine Superintendent',
  companyName: 'Harbour Line Shipping',
  companyId: '22222222-2222-4222-8222-222222222222',
  companySlug: 'harbour-line',
  companyLogoPath: 'companies/22222222-2222-4222-8222-222222222222/logo-abc123.webp',
  companyLocation: 'Mumbai, India',
  companyVerified: true,
  recruiterVerified: false,
  location: 'Mumbai, India',
  summary: '**Fleet support** for a modern tanker fleet 🌊',
  description: 'Lead vetting readiness.\n\n- Attend vessels\n- Coach crews',
  requirements: 'Master or Chief Engineer licence.',
  applyUntil: '2026-11-30',
  createdAt: '2026-10-01T08:00:00.000Z',
  publishedAt: '2026-10-02T09:30:00.000Z',
  domain: 'shore',
  department: 'Technical',
  rank: 'Marine Superintendent',
  vesselTypes: [],
  experienceMinYears: 5,
  experienceMaxYears: null,
  joiningFrom: '2026-12-15',
  joiningUntil: null,
  salaryMin: 90000,
  salaryMax: 120000,
  salaryCurrency: 'USD',
  salaryPeriod: 'year',
  regions: [],
  certificateRequirements: [],
  visaRequirements: [],
  urgent: false,
  easyApply: true,
}

/**
 * The schema.org JobPosting fields Google requires for a job rich result, and the shapes of the
 * optional ones this page sets.
 */
function expectValidJobPosting(data: Record<string, unknown>) {
  expect(data['@context']).toBe('https://schema.org')
  expect(data['@type']).toBe('JobPosting')
  expect(typeof data.title).toBe('string')
  expect((data.title as string).length).toBeGreaterThan(0)
  expect(typeof data.description).toBe('string')
  expect((data.description as string).length).toBeGreaterThan(0)
  expect(Number.isNaN(Date.parse(data.datePosted as string))).toBe(false)
  const organization = data.hiringOrganization as Record<string, unknown>
  expect(organization['@type']).toBe('Organization')
  expect(typeof organization.name).toBe('string')
  if (organization.sameAs) expect(String(organization.sameAs)).toMatch(/^https:\/\//)
  if (organization.logo) expect(String(organization.logo)).toMatch(/^https:\/\//)
  if (data.jobLocationType === undefined) {
    const place = data.jobLocation as { '@type': string; address: Record<string, unknown> }
    expect(place['@type']).toBe('Place')
    expect(place.address['@type']).toBe('PostalAddress')
    expect(place.address.addressLocality ?? place.address.addressCountry).toBeTruthy()
  } else {
    expect(data.jobLocationType).toBe('TELECOMMUTE')
    expect(data.jobLocation).toBeUndefined()
  }
  if (data.validThrough) expect(String(data.validThrough)).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59Z$/)
  if (data.employmentType) expect(['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'TEMPORARY', 'INTERN', 'VOLUNTEER', 'PER_DIEM', 'OTHER']).toContain(data.employmentType)
  if (data.baseSalary) {
    const salary = data.baseSalary as { '@type': string; currency: string; value: Record<string, unknown> }
    expect(salary['@type']).toBe('MonetaryAmount')
    expect(salary.currency).toMatch(/^[A-Z]{3}$/)
    expect(salary.value['@type']).toBe('QuantitativeValue')
    expect(typeof (salary.value.value ?? salary.value.minValue)).toBe('number')
    if (salary.value.unitText) expect(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']).toContain(salary.value.unitText)
  }
}

describe('JobPosting structured data (round H, H5)', () => {
  it('describes a shore job with salary range, office place, logo and Easy Apply', () => {
    const data = jobPostingJsonLd(base, ORIGIN)
    expectValidJobPosting(data)
    expect(data).toMatchObject({
      title: 'Marine Superintendent',
      datePosted: '2026-10-02T09:30:00.000Z',
      validThrough: '2026-11-30T23:59:59Z',
      employmentType: 'FULL_TIME',
      directApply: true,
      hiringOrganization: {
        name: 'Harbour Line Shipping',
        sameAs: `${ORIGIN}/organizations/harbour-line`,
        logo: `${ORIGIN}/api/company-logo/22222222-2222-4222-8222-222222222222?v=logo-abc123.webp`,
      },
      jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Mumbai', addressCountry: 'IN' } },
      baseSalary: { '@type': 'MonetaryAmount', currency: 'USD', value: { '@type': 'QuantitativeValue', minValue: 90000, maxValue: 120000, unitText: 'YEAR' } },
      url: `${ORIGIN}/jobs/${base.id}`,
    })
  })

  it('uses plain text for the description (no Markdown, emoji or raw line breaks inside a section)', () => {
    const { description } = jobPostingJsonLd(base, ORIGIN)
    expect(description).toBe('Fleet support for a modern tanker fleet\n\nLead vetting readiness. Attend vessels Coach crews\n\nMaster or Chief Engineer licence.')
  })

  it('lists a worldwide sea job as TEMPORARY at the employer\'s office, not as remote work (Google keeps TELECOMMUTE for remote jobs)', () => {
    const data = jobPostingJsonLd({ ...base, domain: 'sea', location: 'Worldwide', regions: ['Worldwide', 'Singapore', 'Middle East'], salaryMin: 250, salaryMax: null, salaryPeriod: 'day', easyApply: false, companyLogoPath: null, companySlug: null, companyId: null }, ORIGIN)
    expectValidJobPosting(data)
    expect(data.employmentType).toBe('TEMPORARY')
    expect(data.jobLocationType).toBeUndefined()
    expect(data.jobLocation).toEqual({ '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Mumbai', addressCountry: 'IN' } })
    expect(data.baseSalary).toEqual({ '@type': 'MonetaryAmount', currency: 'USD', value: { '@type': 'QuantitativeValue', value: 250, unitText: 'DAY' } })
    expect(data.directApply).toBeUndefined()
    expect(data.hiringOrganization).toEqual({ '@type': 'Organization', name: 'Harbour Line Shipping' })

    // With no office to name, a worldwide job falls back to a remote role with country requirements from its regions.
    const noOffice = jobPostingJsonLd({ ...base, domain: 'sea', location: 'Worldwide', companyLocation: null, regions: ['Worldwide', 'Singapore', 'Middle East'] }, ORIGIN)
    expectValidJobPosting(noOffice)
    expect(noOffice.jobLocationType).toBe('TELECOMMUTE')
    expect(noOffice.applicantLocationRequirements).toEqual([{ '@type': 'Country', name: 'Singapore' }])
  })

  it('treats a remote job as TELECOMMUTE, falls back to the office when the job names no place, and leaves out absent salary', () => {
    const remote = jobPostingJsonLd({ ...base, location: 'Remote (India)', regions: ['India'], salaryMin: null, salaryMax: null }, ORIGIN)
    expectValidJobPosting(remote)
    expect(remote.jobLocationType).toBe('TELECOMMUTE')
    expect(remote.applicantLocationRequirements).toEqual([{ '@type': 'Country', name: 'India' }])
    expect(remote.baseSalary).toBeUndefined()

    const office = jobPostingJsonLd({ ...base, location: null }, ORIGIN)
    expectValidJobPosting(office)
    expect(office.jobLocation).toEqual({ '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Mumbai', addressCountry: 'IN' } })

    const nowhere = jobPostingJsonLd({ ...base, location: null, companyLocation: null, regions: [] }, ORIGIN)
    expectValidJobPosting(nowhere)
    expect(nowhere.jobLocationType).toBe('TELECOMMUTE')
    expect(nowhere.applicantLocationRequirements).toBeUndefined()
  })

  it('ends validThrough on the earlier of the apply-by date and the joining window', () => {
    expect(jobLastDay({ applyUntil: '2026-11-30', joiningFrom: '2026-11-10', joiningUntil: null })).toBe('2026-11-10')
    expect(jobLastDay({ applyUntil: null, joiningFrom: '2026-11-10', joiningUntil: '2026-11-20' })).toBe('2026-11-20')
    expect(jobLastDay({ applyUntil: null, joiningFrom: null, joiningUntil: null })).toBeNull()
    expect(jobPostingJsonLd({ ...base, applyUntil: null, joiningFrom: null }, ORIGIN).validThrough).toBeUndefined()
  })

  it('parses locations into a postal address', () => {
    expect(postalAddress('Dubai, UAE')).toEqual({ '@type': 'PostalAddress', addressLocality: 'Dubai', addressCountry: 'AE' })
    expect(postalAddress('Netherlands')).toEqual({ '@type': 'PostalAddress', addressCountry: 'NL' })
    expect(postalAddress('Delhi, Kochi, Chennai')).toEqual({ '@type': 'PostalAddress', addressLocality: 'Delhi, Kochi', addressCountry: 'Chennai' })
    expect(postalAddress('Rotterdam')).toEqual({ '@type': 'PostalAddress', addressLocality: 'Rotterdam' })
    expect(countryCode('greece')).toBe('GR')
    expect(countryCode('Middle East')).toBeNull()
  })
})

describe('job page metadata (round H, H5)', () => {
  it('is indexable with a canonical address and a plain description while open', () => {
    const metadata = jobMetadata(base, '2026-10-17')
    expect(metadata.title).toBe('Marine Superintendent at Harbour Line Shipping')
    expect(metadata.alternates?.canonical).toBe(`/jobs/${base.id}`)
    expect(metadata.description).toBe('Fleet support for a modern tanker fleet')
    expect(metadata.robots).toBeUndefined()
  })

  it('carries noindex once the apply-by date or the joining window has passed', () => {
    expect(jobMetadata(base, '2026-12-01').robots).toEqual({ index: false, follow: true })
    expect(jobMetadata({ ...base, applyUntil: null, joiningFrom: '2026-10-01' }, '2026-10-17').robots).toEqual({ index: false, follow: true })
  })

  it('uses the Portrait share image as og:image for open jobs only (Round I, I1)', () => {
    const job = base
    const open = jobMetadata(job, '2026-10-17')
    expect(open.openGraph?.images).toEqual([expect.stringMatching(new RegExp(`^/api/jobs/${base.id}/og-image\\?v=[0-9a-z]+$`))])
    expect(open.twitter).toMatchObject({ card: 'summary_large_image' })
    const closed = jobMetadata(job, '2026-12-01')
    expect(closed.openGraph?.images).toBeUndefined()
    expect(closed.twitter).toMatchObject({ card: 'summary' })
    expect(jobMetadata({ ...base }, '2026-10-17').openGraph?.images).toEqual(open.openGraph?.images)
    const edited = jobMetadata({ ...base, title: 'Chief Engineer' }, '2026-10-17')
    expect(edited.openGraph?.images).not.toEqual(open.openGraph?.images)
  })

  it('gives /jobs a canonical address and a description of at most 160 characters', () => {
    const metadata = jobsIndexMetadata()
    expect(metadata.alternates?.canonical).toBe('/jobs')
    expect(String(metadata.description).length).toBeLessThanOrEqual(160)
  })

  it('accepts only UUID job ids', () => {
    expect(isJobId(base.id)).toBe(true)
    expect(isJobId('saved')).toBe(false)
    expect(isJobId(`${base.id}x`)).toBe(false)
  })
})
