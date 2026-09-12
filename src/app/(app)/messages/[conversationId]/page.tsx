import { notFound } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { MessageShell } from '@/features/messaging/components/message-shell'
import { getConversationInbox, getConversationThread } from '@/features/messaging/queries'

export default async function MessageConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = await params
  const viewer = await requireAwsUser()
  const inbox = await getConversationInbox({ limit: 100 })

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

  const peer = inbox.find((item) => item.conversationId === conversationId)
  const activeConversation = {
    conversationId,
    otherProfileId: peer?.otherProfileId ?? '',
    otherName: peer?.otherName ?? 'Sea N Shore member',
    otherHeadline: peer?.otherHeadline ?? null,
    otherAvatarUrl: peer?.otherAvatarUrl ?? null,
    messages: thread.messages,
    nextCursor: thread.nextCursor,
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <MessageShell
        viewerId={viewer.id}
        inbox={inbox}
        activeConversation={activeConversation}
      />
    </div>
  )
}
