import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { MessageShell } from '@/features/messaging/components/message-shell'
import { getConversationInbox, getConversationThread, getUnreadMessageCount } from '@/features/messaging/queries'
import { getConversationPeer } from '@/features/messaging/recipient-queries'
import { createProductionMessagingService } from '@/features/messaging/service'

export const metadata: Metadata = { title: 'Messages' }

const messagingService = createProductionMessagingService()

export default async function MessageConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = await params
  const viewer = await requireAwsUser()

  let thread
  try {
    thread = await getConversationThread({ conversationId, limit: 50 })
  } catch (error) {
    if (
      error instanceof Error
      && (error.message === 'messaging_not_participant' || error.message === 'messaging_invalid_thread_request')
    ) {
      notFound()
    }
    throw error
  }

  const latestVisibleMessage = thread.messages.at(-1)
  if (latestVisibleMessage) {
    await messagingService.markConversationRead(
      viewer.id,
      conversationId,
      latestVisibleMessage.id,
    )
  }

  const [inbox, authoritativeUnreadCount] = await Promise.all([
    getConversationInbox({ limit: 100 }),
    getUnreadMessageCount(),
  ])
  const peer = inbox.find((item) => item.conversationId === conversationId)
  // A conversation just started from New Message may sit beyond the first
  // inbox page; look the other participant up directly so the header is right.
  const fallbackPeer = peer ? null : await getConversationPeer(viewer.id, conversationId).catch(() => null)
  const activeConversation = {
    conversationId,
    otherProfileId: peer?.otherProfileId ?? fallbackPeer?.otherProfileId ?? '',
    otherName: peer?.otherName ?? fallbackPeer?.otherName ?? 'Sea N Shore member',
    otherHeadline: peer?.otherHeadline ?? fallbackPeer?.otherHeadline ?? null,
    otherAvatarUrl: peer?.otherAvatarUrl ?? fallbackPeer?.otherAvatarUrl ?? null,
    otherLastReadMessageId: peer?.otherLastReadMessageId ?? null,
    otherLastReadAt: peer?.otherLastReadAt ?? null,
    messages: thread.messages,
    nextCursor: thread.nextCursor,
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <MessageShell
        viewerId={viewer.id}
        inbox={inbox}
        activeConversation={activeConversation}
        authoritativeUnreadCount={authoritativeUnreadCount}
      />
    </div>
  )
}
