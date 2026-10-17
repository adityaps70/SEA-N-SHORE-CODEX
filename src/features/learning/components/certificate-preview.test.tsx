import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CertificatePreview, SAMPLE_LEARNER_NAME, sampleCertificateNumber, sampleValidity } from './certificate-preview'

const settings = { template: 'classic' as const, signatoryName: 'Placeholder Signatory', signatoryTitle: 'Training Director', serialPrefix: null, validityMonths: null }

describe('CertificatePreview (Round H, H7)', () => {
  afterEach(() => cleanup())

  it('renders each template as one labelled image with placeholder learner details', () => {
    for (const template of ['classic', 'modern', 'formal', 'minimal'] as const) {
      render(<CertificatePreview settings={{ ...settings, template, validityMonths: 24 }} courseTitle="Tanker Safety" mentorName="Placeholder Trainer" />)
      const preview = screen.getByRole('img', { name: /Sample certificate of completion for Tanker Safety/ })
      expect(preview).toHaveAttribute('data-template', template)
      expect(preview.getAttribute('aria-label')).toContain(SAMPLE_LEARNER_NAME)
      expect(preview.getAttribute('aria-label')).toContain('signed by Placeholder Signatory, Training Director')
      expect(preview.getAttribute('aria-label')).toContain('Valid for 24 months from issue')
      expect(preview).toHaveTextContent(SAMPLE_LEARNER_NAME)
      cleanup()
    }
  })

  it('shows sample serials and validity from the settings', () => {
    expect(sampleCertificateNumber(null)).toBe('SNS-XXXXXXXX')
    expect(sampleCertificateNumber('SNS-SIRE-')).toMatch(/^SNS-SIRE-\d{4}-XXXXXXXX$/)
    expect(sampleValidity(null)).toBeNull()
    expect(sampleValidity(1)).toBe('Valid for 1 month from issue')
  })
})
