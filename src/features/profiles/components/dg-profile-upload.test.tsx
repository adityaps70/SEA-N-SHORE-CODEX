import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../profile-document-actions', () => ({
  prepareDgProfileUpload: mocks.prepare,
  confirmDgProfileUpload: mocks.confirm,
  removeDgProfileUpload: mocks.remove,
}))

import { DgProfileUpload } from './dg-profile-upload'

const profileId = '11111111-1111-4111-8111-111111111111'
const onFile = { kind: 'dg_profile' as const, fileName: 'DG profile.pdf', sizeBytes: 2048, uploadedAt: '2026-09-20T10:00:00.000Z' }

function fileInput(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('file input missing')
  return input
}

beforeEach(() => {
  mocks.prepare.mockReset()
  mocks.confirm.mockReset()
  mocks.remove.mockReset()
  mocks.refresh.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DG profile upload', () => {
  it('keeps the PDF out of the surrounding form submission and accepts only PDFs', () => {
    const { container } = render(<DgProfileUpload profileId={profileId} initialDocument={null} variant="onboarding" />)
    const input = fileInput(container)
    expect(input).not.toHaveAttribute('name')
    expect(input).toHaveAttribute('accept', 'application/pdf,.pdf')
    expect(screen.getByRole('button', { name: 'Add DG profile PDF' })).toBeInTheDocument()
    expect(screen.getByText('PDF only, up to 10 MB.')).toBeInTheDocument()
  })

  it('uploads to the presigned URL, confirms on the server and shows the on-file badge', async () => {
    mocks.prepare.mockResolvedValue({ ok: true, uploadUrl: 'https://bucket.example/put', storagePath: 'profile-documents/x.pdf', fileName: 'DG profile.pdf', sizeBytes: 2048 })
    mocks.confirm.mockResolvedValue({ ok: true, document: onFile })
    const { container } = render(<DgProfileUpload profileId={profileId} initialDocument={null} variant="onboarding" />)

    const file = new File([new Uint8Array(2048)], 'DG profile.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInput(container), { target: { files: [file] } })

    expect(await screen.findByText('DG profile on file')).toBeInTheDocument()
    expect(mocks.prepare).toHaveBeenCalledWith({ fileName: 'DG profile.pdf', mimeType: 'application/pdf', sizeBytes: 2048 })
    expect(fetch).toHaveBeenCalledWith('https://bucket.example/put', expect.objectContaining({ method: 'PUT', body: file }))
    expect(mocks.confirm).toHaveBeenCalledWith({ storagePath: 'profile-documents/x.pdf', fileName: 'DG profile.pdf', sizeBytes: 2048 })
    expect(screen.getByText('Your DG profile has been added.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View PDF/ })).toHaveAttribute('href', `/api/profile/documents/dg-profile/${profileId}`)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('rejects a non-PDF file in the browser with a clear message', async () => {
    const { container } = render(<DgProfileUpload profileId={profileId} initialDocument={null} variant="profile" />)
    fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose your DG profile as a PDF file of 10 MB or less.')
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('shows the server explanation when the uploaded bytes are not a PDF', async () => {
    mocks.prepare.mockResolvedValue({ ok: true, uploadUrl: 'https://bucket.example/put', storagePath: 'p.pdf', fileName: 'fake.pdf', sizeBytes: 4 })
    mocks.confirm.mockResolvedValue({ ok: false, error: 'That file is not a readable PDF.' })
    const { container } = render(<DgProfileUpload profileId={profileId} initialDocument={null} variant="profile" />)
    fireEvent.change(fileInput(container), { target: { files: [new File(['MZ!!'], 'fake.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is not a readable PDF.')
    expect(screen.queryByText('DG profile on file')).not.toBeInTheDocument()
  })

  it('explains a failed transfer to storage', async () => {
    mocks.prepare.mockResolvedValue({ ok: true, uploadUrl: 'https://bucket.example/put', storagePath: 'p.pdf', fileName: 'dg.pdf', sizeBytes: 4 })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const { container } = render(<DgProfileUpload profileId={profileId} initialDocument={null} variant="profile" />)
    fireEvent.change(fileInput(container), { target: { files: [new File(['%PDF'], 'dg.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be uploaded/i)
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('asks for confirmation in place before removing, and Escape cancels', async () => {
    const user = userEvent.setup()
    mocks.remove.mockResolvedValue({ ok: true })
    render(<DgProfileUpload profileId={profileId} initialDocument={onFile} variant="profile" />)

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('group', { name: 'Confirm removing your DG profile' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Confirm removing your DG profile' })).not.toBeInTheDocument()
    expect(mocks.remove).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Remove DG profile' }))
    await waitFor(() => expect(screen.getByText('Your DG profile has been removed.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Add DG profile PDF' })).toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalled()
  })
})
