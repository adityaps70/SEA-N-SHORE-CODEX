import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageRecipient } from '../recipients'

const actions = vi.hoisted(() => ({
  startDirectConversationAction: vi.fn(),
}))
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))

vi.mock('../actions', () => actions)
vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
}))

import { NewMessageButton } from './new-message-button'
import { NewMessageDialog } from './new-message-dialog'

const ANITA_ID = '22222222-2222-4222-8222-222222222222'
const ARJUN_ID = '33333333-3333-4333-8333-333333333333'
const PENDING_ID = '44444444-4444-4444-8444-444444444444'
const EXISTING_CONVERSATION_ID = '55555555-5555-4555-8555-555555555555'
const NEW_CONVERSATION_ID = '66666666-6666-4666-8666-666666666666'

const anita: MessageRecipient = {
  profileId: ANITA_ID,
  name: 'Capt. Anita Singh',
  subtitle: 'Master · Blue Ocean Tankers',
  slug: 'anita-singh',
  avatarUrl: null,
  conversationId: EXISTING_CONVERSATION_ID,
  status: 'available',
  unavailableReason: null,
}
const arjun: MessageRecipient = {
  profileId: ARJUN_ID,
  name: 'Arjun Rao',
  subtitle: 'Chief Officer',
  slug: 'arjun-rao',
  avatarUrl: null,
  conversationId: null,
  status: 'available',
  unavailableReason: null,
}
const pending: MessageRecipient = {
  profileId: PENDING_ID,
  name: 'Anil Menon',
  subtitle: null,
  slug: 'anil-menon',
  avatarUrl: null,
  conversationId: null,
  status: 'request_sent',
  unavailableReason: 'Your connection request is pending. You can message once they accept it.',
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname !== '/api/messages/recipients') throw new Error(`Unexpected fetch ${url}`)
    const query = url.searchParams.get('q') ?? ''
    if (!query) return respond({ query, recipients: [anita, arjun], connectionCount: 2 })
    if (query === 'an') return respond({ query, recipients: [anita, pending], connectionCount: 2 })
    return respond({ query, recipients: [], connectionCount: 2 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.style.overflow = ''
})

function renderDialog(overrides: Partial<Parameters<typeof NewMessageDialog>[0]> = {}) {
  const onClose = vi.fn()
  const onConversationReady = vi.fn()
  const view = render(
    <NewMessageDialog
      open
      onClose={onClose}
      onConversationReady={onConversationReady}
      debounceMs={0}
      {...overrides}
    />,
  )
  return { ...view, onClose, onConversationReady }
}

describe('New message dialog', () => {
  it('opens with the search focused and lists the people you can message', async () => {
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'New message' })
    expect(dialog).toHaveTextContent('Choose a connection')
    const input = screen.getByRole('combobox', { name: 'Search your connections' })
    expect(input).toHaveFocus()

    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Capt. Anita Singh'),
      expect.stringContaining('Arjun Rao'),
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/messages/recipients?q=', expect.objectContaining({ cache: 'no-store' }))
  })

  it('searches as you type and explains why a pending connection cannot be messaged', async () => {
    const user = userEvent.setup()
    const { onConversationReady } = renderDialog()
    await screen.findAllByRole('option')

    await user.type(screen.getByRole('combobox'), 'an')

    const pendingOption = await screen.findByRole('option', { name: /Anil Menon/ })
    expect(pendingOption).toHaveAttribute('aria-disabled', 'true')
    expect(pendingOption).toHaveTextContent('Your connection request is pending')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/messages/recipients?q=an', expect.anything())

    await user.click(pendingOption)
    expect(screen.getByRole('alert')).toHaveTextContent('Anil Menon: Your connection request is pending')
    expect(actions.startDirectConversationAction).not.toHaveBeenCalled()
    expect(onConversationReady).not.toHaveBeenCalled()
  })

  it('reuses an existing conversation without creating another one', async () => {
    const user = userEvent.setup()
    const { onConversationReady } = renderDialog()

    await user.click(await screen.findByRole('option', { name: /Capt\. Anita Singh/ }))

    expect(actions.startDirectConversationAction).not.toHaveBeenCalled()
    expect(onConversationReady).toHaveBeenCalledWith({ conversationId: EXISTING_CONVERSATION_ID, recipient: anita })
  })

  it('creates a new conversation through the server action, chosen with the keyboard', async () => {
    const user = userEvent.setup()
    actions.startDirectConversationAction.mockResolvedValueOnce({ ok: true, conversationId: NEW_CONVERSATION_ID })
    const { onConversationReady } = renderDialog()
    await screen.findAllByRole('option')

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: /Arjun Rao/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Arjun Rao/ }).id)
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onConversationReady).toHaveBeenCalledWith({ conversationId: NEW_CONVERSATION_ID, recipient: arjun }))
    expect(actions.startDirectConversationAction).toHaveBeenCalledWith(ARJUN_ID)
  })

  it('shows the server reason when someone can no longer be messaged', async () => {
    const user = userEvent.setup()
    actions.startDirectConversationAction.mockResolvedValueOnce({ ok: false, error: 'You can message accepted connections only.' })
    const { onConversationReady } = renderDialog()

    await user.click(await screen.findByRole('option', { name: /Arjun Rao/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('You can message accepted connections only.')
    expect(onConversationReady).not.toHaveBeenCalled()
  })

  it('shows empty and error states with a way forward', async () => {
    const user = userEvent.setup()
    renderDialog()
    await screen.findAllByRole('option')

    await user.type(screen.getByRole('combobox'), 'zz')
    expect(await screen.findByText('No connections match “zz”')).toBeInTheDocument()

    fetchMock.mockImplementationOnce(async () => respond({ error: 'boom' }, 500))
    await user.type(screen.getByRole('combobox'), 'z')
    expect(await screen.findByText('Connections did not load')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Check your connection and try again')

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No connections match “zzz”')).toBeInTheDocument()
  })

  it('points members without connections to My Network', async () => {
    fetchMock.mockImplementation(async () => respond({ query: '', recipients: [], connectionCount: 0 }))
    renderDialog()

    expect(await screen.findByText('No connections to message yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Find people in My Network' })).toHaveAttribute('href', '/network')
  })

  it('closes with Escape and the close button', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Close new message' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('New Message button', () => {
  it('opens reliably every time and returns focus to the button when closed', async () => {
    const user = userEvent.setup()
    render(<NewMessageButton debounceMs={0} />)
    const button = screen.getByRole('button', { name: 'New Message' })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await user.click(button)
      expect(screen.getByRole('dialog', { name: 'New message' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(button).toHaveFocus()
    }
  })

  it('opens the chosen conversation on the messages page', async () => {
    const user = userEvent.setup()
    render(<NewMessageButton debounceMs={0} />)

    await user.click(screen.getByRole('button', { name: 'New Message' }))
    const dialog = screen.getByRole('dialog')
    await user.click(await within(dialog).findByRole('option', { name: /Capt\. Anita Singh/ }))

    expect(navigation.push).toHaveBeenCalledWith(`/messages/${EXISTING_CONVERSATION_ID}`)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('just closes when the chosen conversation is already open', async () => {
    const user = userEvent.setup()
    render(<NewMessageButton debounceMs={0} activeConversationId={EXISTING_CONVERSATION_ID} />)

    await user.click(screen.getByRole('button', { name: 'New Message' }))
    await user.click(await screen.findByRole('option', { name: /Capt\. Anita Singh/ }))

    expect(navigation.push).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
