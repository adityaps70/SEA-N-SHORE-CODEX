import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobListing, JobMatchResult } from '../types'

vi.mock('./apply-job-button', () => ({
  ApplyJobButton: () => <button type="button">Easy Apply</button>,
}))
vi.mock('./save-job-button', () => ({
  SaveJobButton: () => <button type="button">Save</button>,
}))

import { JobCard } from './job-card'

const job: JobListing = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Technical Superintendent',
  companyName: 'Beaufort Marine FZE',
  companyId: '22222222-2222-4222-8222-222222222222',
  companySlug: 'beaufort-marine-fze',
  companyLogoPath: 'companies/22222222-2222-4222-8222-222222222222/logo.webp',
  companyVerified: true,
  recruiterVerified: true,
  location: 'Delhi, Kochi, Chennai',
  summary: 'Immediate hiring for a technical superintendent with tanker operations experience.',
  description: 'Role description',
  requirements: null,
  applyUntil: null,
  createdAt: '2026-09-21T10:00:00.000Z',
  publishedAt: '2026-09-21T10:00:00.000Z',
  domain: 'shore',
  department: 'Technical',
  rank: 'Technical Superintendent',
  vesselTypes: [],
  experienceMinYears: null,
  experienceMaxYears: null,
  joiningFrom: null,
  joiningUntil: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  regions: [],
  certificateRequirements: [],
  visaRequirements: [],
  urgent: false,
  easyApply: true,
}

const match: JobMatchResult = {
  score: 60,
  reasons: ['Shore career preference matches this role'],
  missingRequirements: ['Technical Superintendent'],
  warnings: [],
}

afterEach(() => cleanup())

describe('JobCard', () => {
  it('uses the real company logo surface and keeps the match treatment compact without a decorative star icon', () => {
    render(<JobCard job={job} match={match} />)

    const logo = screen.getByRole('img', { name: 'Beaufort Marine FZE logo' })
    expect(logo).toHaveAttribute('src', '/api/company-logo/22222222-2222-4222-8222-222222222222')
    const matchLabel = screen.getByText('Your match')
    expect(matchLabel.closest('[data-job-match]')?.querySelector('svg')).toBeNull()
    // Round 12: banded label with the % from 40%.
    expect(screen.getByText('Good match · 60%')).toBeVisible()
    expect(screen.getByText(job.summary)).toHaveClass('line-clamp-2')
  })

  it('links the posting organization to its page and shows where it is based', () => {
    render(<JobCard job={{ ...job, companyLocation: 'Dubai' }} />)

    expect(screen.getByRole('link', { name: 'Beaufort Marine FZE' })).toHaveAttribute('href', '/organizations/beaufort-marine-fze')
    expect(screen.getByText('Employer based in Dubai')).toBeVisible()
  })

  it('says applications are closed instead of offering Easy Apply once the apply-by date has passed', () => {
    render(<JobCard job={{ ...job, applyUntil: '2020-01-01' }} />)

    expect(screen.getByText('Applications closed')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Easy Apply' })).toBeNull()
  })
})
