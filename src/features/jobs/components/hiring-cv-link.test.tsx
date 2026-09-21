import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HiringCvLink } from './hiring-cv-link'

describe('HiringCvLink', () => {
  it('shows the attached PDF filename, size, and a clear recruiter action', () => {
    render(
      <HiringCvLink
        href="https://signed.example.test/cv"
        fileName="candidate-cv.pdf"
        sizeBytes={1024 * 1024}
      />,
    )

    expect(screen.getByRole('link', { name: 'View CV (PDF)' })).toHaveAttribute(
      'href',
      'https://signed.example.test/cv',
    )
    expect(screen.getByText('candidate-cv.pdf')).toBeVisible()
    expect(screen.getByText(/1 MB/)).toBeVisible()
  })
})
