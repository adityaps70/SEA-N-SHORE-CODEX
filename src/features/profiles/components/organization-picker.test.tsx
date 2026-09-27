import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationPicker } from './organization-picker'

vi.mock('next/navigation', () => ({ usePathname: () => '/profile/edit' }))

const oceanic = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'oceanic-ship-management',
  name: 'Oceanic Ship Management',
  logoUrl: '/api/company-logo/22222222-2222-4222-8222-222222222222',
  verified: true,
  type: 'Ship manager',
  location: 'Mumbai, India',
}
const harbour = {
  id: '33333333-3333-4333-8333-333333333333',
  slug: 'harbour-crew-services',
  name: 'Harbour Crew Services',
  logoUrl: null,
  verified: false,
  type: 'Crewing agency',
  location: null,
}

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function hiddenId(container: HTMLElement) {
  return (container.querySelector('input[name="currentCompanyId"]') as HTMLInputElement).value
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OrganizationPicker', () => {
  it('searches after typing and links the chosen organization by id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ query: 'ocean', organizations: [oceanic, harbour] }))
    const { container } = render(<OrganizationPicker label="Current organization" />)
    const input = screen.getByRole('combobox', { name: 'Current organization' })

    fireEvent.change(input, { target: { value: 'ocean' } })
    const option = await screen.findByRole('option', { name: /Oceanic Ship Management/ })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/profile/organization-search?q=ocean')
    expect(option).toHaveTextContent('Ship manager · Mumbai, India')

    fireEvent.click(option)

    expect(input).toHaveValue('Oceanic Ship Management')
    expect(hiddenId(container)).toBe(oceanic.id)
    expect(screen.getByText('Linked to the Oceanic Ship Management page on Sea N Shore')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does not search for fewer than two characters', async () => {
    render(<OrganizationPicker label="Current organization" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'o' } })
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('offers to create a page when the organization is not listed and keeps the typed name', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ query: 'Blue Anchor Marine', organizations: [] }))
    const { container } = render(<OrganizationPicker label="Current organization" />)
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'Blue Anchor Marine' } })

    const create = await screen.findByRole('link', { name: /Create its page/ })
    expect(create).toHaveAttribute('href', '/organizations?register=1&name=Blue+Anchor+Marine#register-organization')
    expect(create).toHaveAttribute('target', '_blank')
    expect(screen.getByText(/Can.t find Blue Anchor Marine\?/)).toBeInTheDocument()
    expect(screen.getByText(/reviews new organization pages before they go live/)).toBeInTheDocument()
    expect(input).toHaveValue('Blue Anchor Marine')
    expect(hiddenId(container)).toBe('')
  })

  it('supports arrow keys and Enter, and Escape closes the list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ query: 'crew', organizations: [oceanic, harbour] }))
    const { container } = render(<OrganizationPicker label="Current organization" />)
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'crew' } })
    await screen.findByRole('option', { name: /Harbour Crew Services/ })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Harbour Crew Services/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(hiddenId(container)).toBe(harbour.id)

    fireEvent.change(input, { target: { value: 'crew s' } })
    await screen.findByRole('option', { name: /Oceanic Ship Management/ })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('unlinks when the name is edited or Unlink is pressed', async () => {
    const { container } = render(
      <OrganizationPicker label="Current organization" defaultOrganization={{ id: oceanic.id, name: oceanic.name, logoUrl: oceanic.logoUrl }} />,
    )
    expect(hiddenId(container)).toBe(oceanic.id)

    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    expect(hiddenId(container)).toBe('')
    expect(screen.getByRole('combobox')).toHaveValue('Oceanic Ship Management')

    fetchMock.mockResolvedValue(jsonResponse({ query: 'x', organizations: [] }))
    const second = render(
      <OrganizationPicker label="Previous organization" idName="otherId" defaultOrganization={{ id: oceanic.id, name: oceanic.name }} />,
    )
    const input = second.getByRole('combobox', { name: 'Previous organization' })
    fireEvent.change(input, { target: { value: 'Oceanic Ship Mgmt' } })
    expect((second.container.querySelector('input[name="otherId"]') as HTMLInputElement).value).toBe('')
  })

  it('explains a failed search and lets the member keep typing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'You searched a lot in the last minute. Wait a moment and try again, or keep typing the name and save it as text.' }, 429))
    render(<OrganizationPicker label="Current organization" />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ocean' } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Wait a moment and try again')
  })

  it('shows a server error for the field', () => {
    render(<OrganizationPicker label="Current organization" error="That organization is not listed on Sea N Shore any more." />)
    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('That organization is not listed on Sea N Shore any more.')
  })

  it('shows results as they arrive for the latest text only', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ query: 'harb', organizations: [harbour] }))
    render(<OrganizationPicker label="Current organization" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'har' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'harb' } })
    await screen.findByRole('option', { name: /Harbour Crew Services/ })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})
