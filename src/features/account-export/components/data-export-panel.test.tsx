import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataExportPanel } from './data-export-panel'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

  it('shows the server message instead of saving an error file when the export fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'Your session has expired. Sign in again to download your data.' }), { status: 401 })))
    if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = () => 'blob:test'
    render(<DataExportPanel />)

    await act(async () => {
      fireEvent.click(screen.getByRole('link', { name: 'Download ZIP' }))
    })

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired. Sign in again to download your data.'))
  })
})
