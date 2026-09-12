import { requireAwsUser } from '@/features/auth/aws-queries'
import { MessageShell } from '@/features/messaging/components/message-shell'
import { getConversationInbox } from '@/features/messaging/queries'

export default async function MessagesPage() {
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
