import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessagingMessageDto } from '../queries'

const mocks = vi.hoisted(() => ({
  sendMessageAction: vi.fn(),
  createMessageAttachmentUploadAction: vi.fn(),
  discardMessageAttachmentAction: vi.fn(),
  uploadMessageAttachmentFile: vi.fn(),
}))

vi.mock('../actions', () => ({
  sendMessageAction: mocks.sendMessageAction,
  createMessageAttachmentUploadAction: mocks.createMessageAttachmentUploadAction,
  discardMessageAttachmentAction: mocks.discardMessageAttachmentAction,
}))

vi.mock('./upload-message-attachment', () => ({
  uploadMessageAttachmentFile: mocks.uploadMessageAttachmentFile,
}))

import { MessageComposer } from './message-composer'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const REPLY_ID = '44444444-4444-4444-8444-444444444444'

function canonical(overrides: Partial<MessagingMessageDto> = {}): MessagingMessageDto {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    conversationId: CONVERSATION_ID,
    senderProfileId: VIEWER_ID,
    clientMessageId: '66666666-6666-4666-8666-666666666666',
    body: '',
    createdAt: '2026-09-20T10:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    replyTo: null,
    attachment: null,
    reactions: [],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MessageComposer rich messaging', () => {
  it('inserts an emoji into the composer and can send an emoji-only message', async () => {
    const user = userEvent.setup()
    const onOptimisticMessage = vi.fn()
    mocks.sendMessageAction.mockImplementationOnce(async (input) => ({
      ok: true,
      message: canonical({ clientMessageId: input.clientMessageId, body: '🫡' }),
    }))

    render(
      <MessageComposer
        conversationId={CONVERSATION_ID}
        viewerId={VIEWER_ID}
        onOptimisticMessage={onOptimisticMessage}
        onMessageConfirmed={vi.fn()}
        onMessageFailed={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add emoji' }))
    await user.click(screen.getByRole('button', { name: 'Insert 🫡' }))
    expect(screen.getByRole('textbox', { name: 'Write a message' })).toHaveValue('🫡')

    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(mocks.sendMessageAction).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: CONVERSATION_ID,
      body: '🫡',
    }))
  })

  it('uploads a photo, shows a preview state, and sends it even without text', async () => {
    const user = userEvent.setup()
    const storagePath = `messages/${VIEWER_ID}/${CONVERSATION_ID}/77777777-7777-4777-8777-777777777777.jpg`
    mocks.createMessageAttachmentUploadAction.mockResolvedValueOnce({
      ok: true,
      upload: {
        storagePath,
        name: 'bridge.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        kind: 'image',
        uploadUrl: 'https://upload.example.test/signed',
      },
    })
    mocks.uploadMessageAttachmentFile.mockImplementationOnce(async ({ onProgress }) => {
      onProgress(50)
      onProgress(100)
    })
    mocks.sendMessageAction.mockImplementationOnce(async (input) => ({
      ok: true,
      message: canonical({
        clientMessageId: input.clientMessageId,
        attachment: {
          name: 'bridge.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          kind: 'image',
          url: 'https://read.example.test/bridge.jpg',
        },
      }),
    }))

    const { container } = render(
      <MessageComposer
        conversationId={CONVERSATION_ID}
        viewerId={VIEWER_ID}
        onOptimisticMessage={vi.fn()}
        onMessageConfirmed={vi.fn()}
        onMessageFailed={vi.fn()}
      />,
    )

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array(1024)], 'bridge.jpg', { type: 'image/jpeg' })
    await user.upload(fileInput, file)

    await waitFor(() => expect(screen.getByText('bridge.jpg')).toBeInTheDocument())
    expect(screen.getByText('Ready to send')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(mocks.sendMessageAction).toHaveBeenCalledWith(expect.objectContaining({
      body: '',
      attachment: {
        storagePath,
        name: 'bridge.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
      },
    }))
  })

  it('sends a reply reference and allows cancelling the reply before sending', async () => {
    const user = userEvent.setup()
    const onCancelReply = vi.fn()
    const replyTo = canonical({
      id: REPLY_ID,
      senderProfileId: OTHER_ID,
      body: 'Please send the bridge photo.',
    })
    mocks.sendMessageAction.mockImplementationOnce(async (input) => ({
      ok: true,
      message: canonical({
        clientMessageId: input.clientMessageId,
        body: 'Sending now.',
        replyTo: {
          messageId: REPLY_ID,
          senderProfileId: OTHER_ID,
          body: 'Please send the bridge photo.',
          attachmentName: null,
          deleted: false,
        },
      }),
    }))

    render(
      <MessageComposer
        conversationId={CONVERSATION_ID}
        viewerId={VIEWER_ID}
        replyTo={replyTo}
        onCancelReply={onCancelReply}
        onOptimisticMessage={vi.fn()}
        onMessageConfirmed={vi.fn()}
        onMessageFailed={vi.fn()}
      />,
    )

    expect(screen.getByText('Replying to message')).toBeInTheDocument()
    expect(screen.getByText('Please send the bridge photo.')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Write a message' }), 'Sending now.')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(mocks.sendMessageAction).toHaveBeenCalledWith(expect.objectContaining({
      replyToMessageId: REPLY_ID,
    }))
    expect(onCancelReply).toHaveBeenCalled()
  })
})
