import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../hiring-actions', () => ({ changeHiringJobStatus: vi.fn(), deleteHiringJob: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { HiringJobRowMenu } from './hiring-job-row-menu'

afterEach(() => cleanup())

describe('HiringJobRowMenu (phones)', () => {
  it('puts View applicants, Edit, View live job and the lifecycle actions in one sheet', () => {
    render(
      <HiringJobRowMenu
        jobId="job-1"
        jobTitle="Chief Officer"
        lifecycle={{ status: 'published', deleted: false, moderationRemoved: false, applyUntil: null, joiningUntil: null, applicantCount: 3, canDelete: true }}
        today="2026-09-29"
        live
        applicantCount={3}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Manage Chief Officer' }))
    const sheet = screen.getByRole('dialog', { name: 'Chief Officer' })
    expect(within(sheet).getByRole('link', { name: /View applicants/ })).toHaveAttribute('href', '/hiring/jobs/job-1/applicants')
    expect(within(sheet).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/hiring/jobs/job-1/edit')
    expect(within(sheet).getByRole('link', { name: 'View live job' })).toHaveAttribute('href', '/jobs/job-1')
    const manage = within(sheet).getByRole('group', { name: 'Manage Chief Officer' })
    expect(within(manage).getByRole('button', { name: 'Archive' })).toBeInTheDocument()

    fireEvent.click(within(manage).getByRole('button', { name: 'Archive' }))
    expect(within(sheet).getByRole('button', { name: 'Archive job' })).toBeInTheDocument()
  })
})
