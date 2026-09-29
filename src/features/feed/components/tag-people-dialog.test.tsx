import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PhotoTagCandidate } from '../photo-tag-actions'
import { TagPeopleDialog } from './tag-people-dialog'

const mocks = vi.hoisted(() => ({
  searchPhotoTagCandidates: vi.fn<(query: string) => Promise<{ ok: true; candidates: PhotoTagCandidate[] } | { ok: false; error: string }>>(),
}))

vi.mock('../photo-tag-actions', () => ({ searchPhotoTagCandidates: mocks.searchPhotoTagCandidates }))

const rao: PhotoTagCandidate = { id: '11111111-1111-4111-8111-111111111111', slug: 'captain-rao', fullName: 'Captain Rao', avatarUrl: null, detail: 'Master · Blue Fleet', connected: true }
const lee: PhotoTagCandidate = { id: '22222222-2222-4222-8222-222222222222', slug: 'officer-lee', fullName: 'Officer Lee', avatarUrl: null, detail: 'Second Officer', connected: true }
const ali: PhotoTagCandidate = { id: '33333333-3333-4333-8333-333333333333', slug: 'cadet-ali', fullName: 'Cadet Ali', avatarUrl: null, detail: 'Deck cadet', connected: false }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchPhotoTagCandidates.mockResolvedValue({ ok: true, candidates: [rao, lee, ali] })
})

afterEach(() => cleanup())

describe('TagPeopleDialog', () => {
  it('lists connections before other members, searches by name, and hands the ticked people to Done', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<TagPeopleDialog photoLabel="photo 1" initialSelected={[]} onDone={onDone} onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'Tag people' })
    expect(dialog).toHaveTextContent('Choose who is in photo 1.')
    await waitFor(() => expect(mocks.searchPhotoTagCandidates).toHaveBeenCalledWith(''))
    const connections = await screen.findByRole('region', { name: 'Your connections' })
    expect(within(connections).getByRole('checkbox', { name: 'Tag Captain Rao' })).toBeInTheDocument()
    expect(within(connections).getByText('Master · Blue Fleet')).toBeInTheDocument()
    const others = screen.getByRole('region', { name: 'Other members' })
    expect(within(others).getByRole('checkbox', { name: 'Tag Cadet Ali' })).toBeInTheDocument()
    expect(connections.compareDocumentPosition(others) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'lee')
    await waitFor(() => expect(mocks.searchPhotoTagCandidates).toHaveBeenLastCalledWith('lee'))

    await user.click(await screen.findByRole('checkbox', { name: 'Tag Captain Rao' }))
    await user.click(screen.getByRole('checkbox', { name: 'Tag Cadet Ali' }))
    const chips = screen.getByRole('list', { name: 'Tagged people' })
    expect(within(chips).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Captain Rao', 'Cadet Ali'])
    expect(screen.getByText('2 of 20 selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledWith([
      { profileId: rao.id, fullName: 'Captain Rao' },
      { profileId: ali.id, fullName: 'Cadet Ali' },
    ])
  })

  it('shows the people already tagged as removable chips and unticks them from the list', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<TagPeopleDialog photoLabel="photo 2" initialSelected={[{ profileId: lee.id, fullName: 'Officer Lee' }]} onDone={onDone} onClose={vi.fn()} />)

    const chips = screen.getByRole('list', { name: 'Tagged people' })
    expect(within(chips).getByText('Officer Lee')).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: 'Tag Officer Lee' })).toBeChecked()

    await user.click(within(chips).getByRole('button', { name: 'Remove Officer Lee' }))
    expect(screen.queryByRole('list', { name: 'Tagged people' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Tag Officer Lee' })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledWith([])
  })

  it('caps the selection and explains the limit', async () => {
    const user = userEvent.setup()
    render(<TagPeopleDialog photoLabel="photo 1" initialSelected={[]} max={2} onDone={vi.fn()} onClose={vi.fn()} />)

    await user.click(await screen.findByRole('checkbox', { name: 'Tag Captain Rao' }))
    await user.click(screen.getByRole('checkbox', { name: 'Tag Officer Lee' }))
    expect(screen.getByText('You can tag up to 2 people in a photo.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Tag Cadet Ali' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Tag Officer Lee' })).toBeEnabled()
  })

  it('offers a retry when the search fails', async () => {
    const user = userEvent.setup()
    mocks.searchPhotoTagCandidates.mockResolvedValueOnce({ ok: false, error: 'We could not load people to tag. Check your internet connection and try again.' })
    render(<TagPeopleDialog photoLabel="photo 1" initialSelected={[]} onDone={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load people to tag.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('checkbox', { name: 'Tag Captain Rao' })).toBeInTheDocument()
  })

  it('closes on Escape and Cancel without leaking Escape or Enter to a surrounding composer', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    const composerEscape = vi.fn()
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !event.defaultPrevented) composerEscape() })
    render(
      <form onSubmit={onSubmit}>
        <TagPeopleDialog photoLabel="photo 1" initialSelected={[]} onDone={vi.fn()} onClose={onClose} />
      </form>,
    )

    const search = await screen.findByRole('searchbox', { name: 'Search people' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(composerEscape).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
