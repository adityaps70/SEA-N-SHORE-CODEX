import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobListing } from '../types'

vi.mock('./save-job-button', () => ({
  SaveJobButton: ({ jobTitle, initialSaved, variant }: { jobTitle: string; initialSaved: boolean; variant: string }) => (
    <button type="button" aria-pressed={initialSaved} data-variant={variant}>{`Save ${jobTitle}`}</button>
  ),
}))

import { JobListRow, JobRowList } from './job-list-row'

const job: JobListing = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Chief Officer — Offshore (AHTS)',
  companyName: 'Star Sea Management',
  companyId: '22222222-2222-4222-8222-222222222222',
  companySlug: 'star-sea',
  companyLogoPath: null,
  companyVerified: false,
  recruiterVerified: false,
  location: 'United Arab Emirates',
  summary: 'Summary',
  description: 'Description',
  requirements: null,
  applyUntil: null,
  createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  publishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  domain: 'sea',
  department: null,
  rank: 'Chief Officer',
  vesselTypes: ['AHTS'],
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
  urgent: true,
  easyApply: true,
}

afterEach(() => cleanup())

describe('JobListRow (phones)', () => {
  it('shows logo, title link, company, location · joining, one meta line and a bookmark toggle', () => {
    render(<JobRowList label="Jobs"><JobListRow job={job} match={{ score: 82, reasons: [], missingRequirements: [], warnings: [] }} isSaved /></JobRowList>)

    const row = within(screen.getByRole('list', { name: 'Jobs' })).getByRole('listitem')
    expect(within(row).getByRole('link', { name: job.title })).toHaveAttribute('href', `/jobs/${job.id}`)
    expect(within(row).getByText('Star Sea Management')).toBeInTheDocument()
    expect(within(row).getByText('United Arab Emirates · Immediate joining')).toBeInTheDocument()
    expect(row).toHaveTextContent('Strong match · 82%·Easy Apply·3d')
    const bookmark = within(row).getByRole('button', { name: `Save ${job.title}` })
    expect(bookmark).toHaveAttribute('aria-pressed', 'true')
    expect(bookmark).toHaveAttribute('data-variant', 'icon')
  })

  it('says Applied or Applications closed instead of Easy Apply', () => {
    const { rerender } = render(<ul><JobListRow job={job} alreadyApplied /></ul>)
    expect(screen.getByText('Applied')).toBeInTheDocument()
    rerender(<ul><JobListRow job={{ ...job, applyUntil: '2020-01-01' }} /></ul>)
    expect(screen.getByText('Applications closed')).toBeInTheDocument()
  })
})
