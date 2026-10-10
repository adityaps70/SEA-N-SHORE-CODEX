import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GST_EXPORT_PATH, GstExportPanel, previousIndiaMonth } from './gst-export-panel'

afterEach(() => cleanup())

describe('GstExportPanel', () => {
  it('is a GET form to the export route with the previous month chosen', () => {
    render(<GstExportPanel now={new Date('2026-10-10T08:00:00.000Z')} />)
    const month = screen.getByLabelText('Month')
    expect(month).toHaveAttribute('name', 'month')
    expect(month).toHaveAttribute('type', 'month')
    expect(month).toHaveValue('2026-09')
    expect(month).toHaveAttribute('max', '2026-10')
    const form = month.closest('form')!
    expect(form).toHaveAttribute('method', 'get')
    expect(form).toHaveAttribute('action', GST_EXPORT_PATH)
    expect(GST_EXPORT_PATH).toBe('/api/admin/tax/documents')
    expect(screen.getByRole('button', { name: 'Download CSV' })).toHaveAttribute('type', 'submit')
  })

  it('works out the previous month in India, across a year end', () => {
    expect(previousIndiaMonth(new Date('2027-01-15T00:00:00.000Z'))).toBe('2026-12')
    // 31 Oct 2026 20:00 UTC is already 1 Nov in India.
    expect(previousIndiaMonth(new Date('2026-10-31T20:00:00.000Z'))).toBe('2026-10')
  })
})
