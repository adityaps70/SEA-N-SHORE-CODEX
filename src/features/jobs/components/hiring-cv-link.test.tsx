import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HiringCvLink, hiringCvHref } from './hiring-cv-link'

const applicationId = '33333333-3333-4333-8333-333333333333'

describe('HiringCvLink', () => {
  it('shows the attached PDF filename, size, and view and download actions through the authorized CV route', () => {
    render(
      <HiringCvLink
        applicationId={applicationId}
        fileName="candidate-cv.pdf"
        sizeBytes={1024 * 1024}
      />,
    )

    expect(screen.getByRole('link', { name: 'View CV (PDF)' })).toHaveAttribute(
      'href',
      `/api/jobs/applications/${applicationId}/cv`,
    )
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      `/api/jobs/applications/${applicationId}/cv?download=1`,
    )
    expect(screen.getByText('candidate-cv.pdf')).toBeVisible()
    expect(screen.getByText(/1 MB/)).toBeVisible()
  })

  it('never points at a storage URL', () => {
    expect(hiringCvHref(applicationId)).toMatch(/^\/api\/jobs\/applications\//)
    expect(hiringCvHref(applicationId, true)).not.toContain('amazonaws')
  })
})
