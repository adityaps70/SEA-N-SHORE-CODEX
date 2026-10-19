import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SharedJobCard } from './shared-job-card'

const job = { jobId: '7d3f1c2a-1111-4222-8333-444455556666', title: 'Chief Officer', companyName: 'Placeholder Shipping', location: 'Mumbai, India', open: true }

afterEach(() => cleanup())

describe('shared job card (Round I, I1)', () => {
  it('labels the post as a job and links Apply to the job with src=feed_share', () => {
    render(<SharedJobCard job={job} />)
    const card = screen.getByRole('region', { name: 'Job: Chief Officer' })
    expect(card).toHaveTextContent('Job')
    expect(card).toHaveTextContent('Placeholder Shipping · Mumbai, India')
    expect(screen.getByRole('link', { name: 'Apply for Chief Officer' })).toHaveAttribute('href', `/jobs/${job.jobId}?src=feed_share`)
    expect(screen.queryByText('This job is closed')).toBeNull()
  })

  it('says the job is closed instead of offering Apply', () => {
    render(<SharedJobCard job={{ ...job, open: false, location: null }} />)
    expect(screen.getByText('This job is closed')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
