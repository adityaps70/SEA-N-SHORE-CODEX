import type { Metadata } from 'next'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { MessageShell } from '@/features/messaging/components/message-shell'
import { getConversationInbox } from '@/features/messaging/queries'

export const metadata: Metadata = { title: 'Messages' }

export default async function MessagesPage() {
  // New Message searches connections live (/api/messages/recipients), so the
  // inbox page no longer preloads every connection or fails when that list does.
  const [viewer, inbox] = await Promise.all([
    requireAwsUser(),
    getConversationInbox({ limit: 100 }),
  ])

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <MessageShell
        viewerId={viewer.id}
        inbox={inbox}
        activeConversation={null}
      />
    </div>
  )
}
