import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ save: vi.fn(), upload: vi.fn() }))

vi.mock('../admin-actions', () => ({ saveAboutPageAction: mocks.save, createSiteImageUploadAction: mocks.upload }))

import { AboutContentForm } from './about-content-form'

const EMPTY = { founders: [], team: [], partners: [], memberNumbers: { enabled: false, members: true, organizations: true, courses: true } }
const COUNTS = { members: 10, organizations: 2, courses: null }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.save.mockImplementation(async (_state: unknown, formData: FormData) => ({ status: 'success', message: 'Saved.', values: JSON.parse(String(formData.get('about'))) }))
})
afterEach(() => cleanup())

describe('AboutContentForm (round H, H7)', () => {
  it('adds, reorders and removes people, and sends the lists as one value', async () => {
    render(<AboutContentForm initial={EMPTY} imageUrls={{}} liveCounts={COUNTS} />)
    const founders = screen.getByRole('group', { name: 'Founders' })
    fireEvent.click(within(founders).getByRole('button', { name: 'Add founder' }))
    fireEvent.click(within(founders).getByRole('button', { name: 'Add founder' }))
    const names = within(founders).getAllByLabelText('Name')
    fireEvent.change(names[0]!, { target: { value: 'Placeholder First' } })
    fireEvent.change(names[1]!, { target: { value: 'Placeholder Second' } })
    fireEvent.click(within(founders).getByRole('button', { name: 'Move Placeholder Second up' }))
    expect(within(founders).getAllByLabelText('Name').map((input) => (input as HTMLInputElement).value)).toEqual(['Placeholder Second', 'Placeholder First'])
    fireEvent.click(within(founders).getByRole('button', { name: 'Remove Placeholder First' }))

    fireEvent.click(screen.getByRole('checkbox', { name: /Show live member numbers/ }))
    expect(screen.getByText(/not available right now/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save About page' }))
    })
    const sent = JSON.parse(String((mocks.save.mock.calls[0]![1] as FormData).get('about')))
    expect(sent.founders.map((person: { name: string }) => person.name)).toEqual(['Placeholder Second'])
    expect(sent.memberNumbers.enabled).toBe(true)
    await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument())
  })

  it('marks the field an error belongs to and links the message', async () => {
    mocks.save.mockResolvedValueOnce({ status: 'error', message: 'Please fix the highlighted fields and try again.', fieldErrors: { 'founders.0.name': 'Add the person’s name.' } })
    render(<AboutContentForm initial={{ ...EMPTY, founders: [{ name: '', role: '', bio: '', photoPath: null, profileUrl: null }] }} imageUrls={{}} liveCounts={COUNTS} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save About page' }))
    })
    const name = within(screen.getByRole('group', { name: 'Founders' })).getByLabelText('Name')
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
    expect(document.getElementById(name.getAttribute('aria-describedby')!)).toHaveTextContent('Add the person’s name.')
    expect(screen.getByRole('alert')).toHaveTextContent('Some entries need a fix')
  })

  it('refuses a file that is not a small image before asking for an upload link', async () => {
    render(<AboutContentForm initial={{ ...EMPTY, partners: [{ name: 'Placeholder Partner', logoPath: null, websiteUrl: null }] }} imageUrls={{}} liveCounts={COUNTS} />)
    const input = within(screen.getByRole('group', { name: 'Partners' })).getByLabelText('Logo')
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] } })
    })
    await waitFor(() => expect(screen.getByText('Choose a PNG, JPEG or WebP image of 2 MB or less.')).toBeInTheDocument())
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
