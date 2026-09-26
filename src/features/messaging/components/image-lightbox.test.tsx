import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessagingMessageDto } from '../queries'

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))

vi.mock('../actions', () => ({
  markConversationReadAction: vi.fn(async () => ({ ok: true, advanced: true, unreadCount: 0 })),
  setMessageReactionAction: vi.fn(async () => ({ ok: true })),
  editMessageAction: vi.fn(async () => ({ ok: true, message: null })),
  deleteMessageAction: vi.fn(async () => ({ ok: true, messageId: 'unused' })),
}))
vi.mock('../unread-client', () => ({
  publishMessagingUnreadCount: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
}))

import { MessageThread, lightboxImagesFromMessages } from './message-thread'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const FIRST_ID = '44444444-4444-4444-8444-444444444444'
const SECOND_ID = '55555555-5555-4555-8555-555555555555'
const TEXT_ID = '66666666-6666-4666-8666-666666666666'

function photoMessage(id: string, name: string, createdAt: string): MessagingMessageDto {
  return {
    id,
    conversationId: CONVERSATION_ID,
    senderProfileId: OTHER_ID,
    clientMessageId: `${id.slice(0, -1)}9`,
    body: '',
    createdAt,
    editedAt: null,
    deletedAt: null,
    replyTo: null,
    attachment: {
      name,
      mimeType: 'image/jpeg',
      size: 2048,
      kind: 'image',
      url: `/api/messages/attachments/${id}`,
    },
    reactions: [],
  }
}

const messages: MessagingMessageDto[] = [
  photoMessage(FIRST_ID, 'bridge.jpg', '2026-09-20T10:00:00.000Z'),
  {
    ...photoMessage(TEXT_ID, 'unused', '2026-09-20T10:01:00.000Z'),
    body: 'And the engine room:',
    attachment: null,
  },
  photoMessage(SECOND_ID, 'engine-room.jpg', '2026-09-20T10:02:00.000Z'),
]

function renderThread() {
  return render(
    <MessageThread
      viewerId={VIEWER_ID}
      conversationId={CONVERSATION_ID}
      otherName="Capt. Anita"
      otherHeadline={null}
      otherAvatarUrl={null}
      messages={messages}
      nextCursor={null}
      peerReadCursor={null}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.documentElement.style.overflow = ''
})

describe('in-app photo viewer', () => {
  it('opens a sent photo in an overlay instead of navigating away', async () => {
    const user = userEvent.setup()
    renderThread()

    const thumbnail = screen.getByRole('button', { name: 'Open photo bridge.jpg' })
    // No link to the raw file: the photo never opens a new browser page.
    expect(thumbnail.closest('a')).toBeNull()
    expect(screen.queryByRole('link', { name: /bridge/ })).toBeNull()

    await user.click(thumbnail)

    const dialog = screen.getByRole('dialog', { name: /bridge\.jpg/ })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('img', { name: 'bridge.jpg' })).toHaveAttribute('src', `/api/messages/attachments/${FIRST_ID}`)
    expect(within(dialog).getByRole('button', { name: 'Close photo viewer' })).toHaveFocus()
    expect(within(dialog).getByRole('link', { name: 'Download bridge.jpg' }))
      .toHaveAttribute('href', `/api/messages/attachments/${FIRST_ID}?download=1`)
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('closes with Escape and returns focus to the photo without moving the conversation', async () => {
    const user = userEvent.setup()
    renderThread()
    const scrollArea = screen.getByTestId('message-scroll-area')
    scrollArea.scrollTop = 120

    const thumbnail = screen.getByRole('button', { name: 'Open photo engine-room.jpg' })
    await user.click(thumbnail)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(thumbnail).toHaveFocus()
    expect(scrollArea.scrollTop).toBe(120)
    expect(document.documentElement.style.overflow).toBe('')
    // The same conversation stays mounted.
    expect(screen.getByText('And the engine room:')).toBeInTheDocument()
  })

  it('closes with the X button and with a click on the backdrop, but not on the photo', async () => {
    const user = userEvent.setup()
    renderThread()
    const thumbnail = screen.getByRole('button', { name: 'Open photo bridge.jpg' })

    await user.click(thumbnail)
    await user.click(screen.getByRole('button', { name: 'Close photo viewer' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(thumbnail).toHaveFocus()

    await user.click(thumbnail)
    // Clicking the photo zooms rather than closing.
    await user.click(within(screen.getByRole('dialog')).getByRole('img', { name: 'bridge.jpg' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    const backdrop = screen.getByTestId('image-lightbox-backdrop')
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('toggles zoom and fit-to-screen', async () => {
    const user = userEvent.setup()
    renderThread()
    await user.click(screen.getByRole('button', { name: 'Open photo bridge.jpg' }))

    const zoom = screen.getByRole('button', { name: 'Zoom in' })
    expect(zoom).toHaveAttribute('aria-pressed', 'false')
    await user.click(zoom)

    const fit = screen.getByRole('button', { name: 'Fit photo to screen' })
    expect(fit).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('image-lightbox-backdrop')).toHaveClass('overflow-auto')
    await user.click(fit)
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByTestId('image-lightbox-backdrop')).toHaveClass('overflow-hidden')
  })

  it('moves between the photos in the conversation with buttons and arrow keys', async () => {
    const user = userEvent.setup()
    renderThread()
    await user.click(screen.getByRole('button', { name: 'Open photo bridge.jpg' }))

    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous photo' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(screen.getByRole('dialog', { name: /engine-room\.jpg/ })).toBeInTheDocument()
    expect(screen.getByText('2 of 2')).toBeInTheDocument()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('dialog', { name: /bridge\.jpg/ })).toBeInTheDocument()
  })

  it('keeps keyboard focus inside the viewer', async () => {
    const user = userEvent.setup()
    renderThread()
    await user.click(screen.getByRole('button', { name: 'Open photo bridge.jpg' }))
    const dialog = screen.getByRole('dialog')

    for (let step = 0; step < 6; step += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await user.tab({ shift: true })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('shows a clear message when a photo cannot be loaded', async () => {
    const user = userEvent.setup()
    renderThread()
    await user.click(screen.getByRole('button', { name: 'Open photo bridge.jpg' }))

    fireEvent.error(within(screen.getByRole('dialog')).getByRole('img', { name: 'bridge.jpg' }))

    expect(screen.getByRole('alert')).toHaveTextContent('This photo could not be loaded.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(within(screen.getByRole('dialog')).getByRole('img', { name: 'bridge.jpg' }))
      .toHaveAttribute('src', `/api/messages/attachments/${FIRST_ID}?retry=1`)
  })

  it('offers no download link for a photo that is still sending', () => {
    const images = lightboxImagesFromMessages([
      { ...photoMessage(FIRST_ID, 'bridge.jpg', '2026-09-20T10:00:00.000Z'), deliveryState: 'sending' as const, attachment: {
        name: 'bridge.jpg', mimeType: 'image/jpeg', size: 10, kind: 'image' as const, url: 'blob:local-preview',
      } },
      { ...photoMessage(SECOND_ID, 'gone.jpg', '2026-09-20T10:02:00.000Z'), deletedAt: '2026-09-20T10:03:00.000Z' },
    ])
    expect(images).toEqual([{
      id: FIRST_ID,
      src: 'blob:local-preview',
      alt: 'bridge.jpg',
      name: 'bridge.jpg',
      downloadUrl: null,
    }])
  })
})
