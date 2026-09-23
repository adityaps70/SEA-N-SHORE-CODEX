import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataExportPanel } from './data-export-panel'

describe('DataExportPanel', () => {
  it('offers both a normal-user ZIP package and a raw JSON export from Settings', () => {
    render(<DataExportPanel />)

    expect(screen.getByRole('heading', { name: 'Download my data' })).toBeInTheDocument()
    expect(screen.getByText(/profile information, posts and comments, connections/i)).toBeInTheDocument()
    expect(screen.getByText(/ZIP package/i)).toBeInTheDocument()
    expect(screen.getByText(/CSV files/i)).toBeInTheDocument()
    expect(screen.getAllByText(/JSON/i).length).toBeGreaterThan(0)

    const zipLink = screen.getByRole('link', { name: 'Download ZIP' })
    expect(zipLink).toHaveAttribute('href', '/api/account/export?format=zip')
    expect(zipLink).toHaveAttribute('download')

    const jsonLink = screen.getByRole('link', { name: 'Download JSON' })
    expect(jsonLink).toHaveAttribute('href', '/api/account/export?format=json')
    expect(jsonLink).toHaveAttribute('download')
  })
})
