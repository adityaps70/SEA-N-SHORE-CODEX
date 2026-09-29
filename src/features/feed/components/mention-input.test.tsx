import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MentionCandidate } from '../mention-actions'
import { MentionInput, type SelectedMention } from './mention-input'

const mocks = vi.hoisted(() => ({
  searchMentionCandidates: vi.fn(async (): Promise<unknown[]> => []),
  searchHashtags: vi.fn(async (): Promise<unknown[]> => []),
}))

vi.mock('../mention-actions', () => ({ searchMentionCandidates: mocks.searchMentionCandidates }))
vi.mock('@/features/hashtags/actions', () => ({ searchHashtags: mocks.searchHashtags }))

const member: MentionCandidate = {
  kind: 'member',
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'rahul-gupta',
  fullName: 'Rahul Gupta',
  avatarUrl: null,
  headline: 'Master Mariner',
  rank: 'Captain',
  currentCompany: 'Sea N Shore',
}

const organization: MentionCandidate = {
  kind: 'organization',
  id: '33333333-3333-4333-8333-333333333333',
  slug: 'sire-marine',
  name: 'SIRE Marine',
  logoUrl: null,
  subtitle: 'Ship manager · Chennai',
}

function Harness({ initialValue = '', initialMentions = [], onMentions }: { initialValue?: string; initialMentions?: SelectedMention[]; onMentions?: (mentions: SelectedMention[]) => void }) {
  const [value, setValue] = useState(initialValue)
  const [mentions, setMentions] = useState<SelectedMention[]>(initialMentions)
  return (
    <form data-testid="form">
      <MentionInput
        id="body"
        name="body"
        value={value}
        onChange={setValue}
        mentions={mentions}
        onMentionsChange={(next) => { setMentions(next); onMentions?.(next) }}
        placeholder="Write something"
      />
    </form>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MentionInput with organizations', () => {
  it('lists members and organizations together, labelling the organization rows', async () => {
    mocks.searchMentionCandidates.mockResolvedValue([member, organization])
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByPlaceholderText('Write something'), '@si')

    const options = await screen.findAllByRole('option', {}, { timeout: 1200 })
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAttribute('data-kind', 'member')
    expect(within(options[0]!).getByText('Rahul Gupta')).toBeInTheDocument()
    expect(options[1]).toHaveAttribute('data-kind', 'organization')
    expect(within(options[1]!).getByText('SIRE Marine')).toBeInTheDocument()
    expect(within(options[1]!).getByText('Organization')).toBeInTheDocument()
    expect(within(options[1]!).getByText(/Ship manager · Chennai/)).toBeInTheDocument()
    expect(mocks.searchMentionCandidates).toHaveBeenCalledWith('si')
  })

  it('inserts @Name for an organization and submits it as a hidden organizationMentionId', async () => {
    mocks.searchMentionCandidates.mockResolvedValue([member, organization])
    const onMentions = vi.fn()
    const user = userEvent.setup()
    render(<Harness onMentions={onMentions} />)

    const textarea = screen.getByPlaceholderText('Write something')
    await user.type(textarea, 'Thanks @si')
    await user.click(await screen.findByRole('option', { name: /SIRE Marine/ }, { timeout: 1200 }))

    expect(textarea).toHaveValue('Thanks @SIRE Marine ')
    expect(onMentions).toHaveBeenLastCalledWith([
      { kind: 'organization', profileId: organization.id, label: 'SIRE Marine', slug: 'sire-marine', logoUrl: null },
    ])
    const form = screen.getByTestId('form')
    const hidden = form.querySelector<HTMLInputElement>('input[name="organizationMentionId"]')
    expect(hidden?.value).toBe(organization.id)
    expect(form.querySelector('input[name="mentionProfileId"]')).toBeNull()

    // Removing the label from the text drops the organization mention again.
    await user.clear(textarea)
    expect(form.querySelector('input[name="organizationMentionId"]')).toBeNull()
  })

  it('keeps members as mentionProfileId, treating a mention without a kind as a member', async () => {
    mocks.searchMentionCandidates.mockResolvedValue([member])
    const user = userEvent.setup()
    render(<Harness initialValue="Hi @Legacy Member and " initialMentions={[{ profileId: 'legacy-id', label: 'Legacy Member' }]} />)

    const textarea = screen.getByPlaceholderText('Write something')
    await user.type(textarea, '@ra')
    await user.click(await screen.findByRole('option', { name: /Rahul Gupta/ }, { timeout: 1200 }))

    const form = screen.getByTestId('form')
    const ids = [...form.querySelectorAll<HTMLInputElement>('input[name="mentionProfileId"]')].map((input) => input.value)
    expect(ids).toEqual(['legacy-id', member.id])
    expect(form.querySelector('input[name="organizationMentionId"]')).toBeNull()
  })
})

describe('MentionInput hashtag suggestions', () => {
  it('suggests existing hashtags after # and completes the tag with a trailing space', async () => {
    mocks.searchHashtags.mockResolvedValue([{ tag: 'sire2', postCount: 12 }, { tag: 'sire_vetting', postCount: 1 }])
    const user = userEvent.setup()
    render(<Harness />)

    const textarea = screen.getByPlaceholderText('Write something')
    await user.type(textarea, 'Ready for #Si')

    const options = await screen.findAllByRole('option', {}, { timeout: 1200 })
    expect(options.map((option) => option.getAttribute('data-kind'))).toEqual(['hashtag', 'hashtag'])
    expect(within(options[0]!).getByText('#sire2')).toBeInTheDocument()
    expect(within(options[0]!).getByText('12 posts')).toBeInTheDocument()
    expect(within(options[1]!).getByText('1 post')).toBeInTheDocument()
    expect(mocks.searchHashtags).toHaveBeenCalledWith('si')
    expect(mocks.searchMentionCandidates).not.toHaveBeenCalled()

    await user.keyboard('{ArrowDown}{Enter}')
    expect(textarea).toHaveValue('Ready for #sire_vetting ')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByTestId('form').querySelector('input[type="hidden"]')).toBeNull()
  })

  it('does not treat # inside a URL or a word as a hashtag query', async () => {
    mocks.searchHashtags.mockResolvedValue([{ tag: 'top', postCount: 3 }])
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByPlaceholderText('Write something'), 'see example.com/a#top')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(mocks.searchHashtags).not.toHaveBeenCalled()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })
})
