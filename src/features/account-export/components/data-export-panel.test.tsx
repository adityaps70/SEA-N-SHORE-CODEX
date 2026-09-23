import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataExportPanel } from './data-export-panel'

describe('DataExportPanel', () => {
  it('offers a clear portable account data download from Settings', () => {
    render(<DataExportPanel />)

    expect(screen.getByRole('heading', { name: 'Download my data' })).toBeInTheDocument()
    expect(screen.getByText(/profile information, posts and comments, connections/i)).toBeInTheDocument()
    expect(screen.getByText(/JSON/i)).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Export my data' })
    expect(link).toHaveAttribute('href', '/api/account/export')
  })
})
