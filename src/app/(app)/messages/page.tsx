import { requireAwsUser } from '@/features/auth/aws-queries'
import { NewMessageButton } from '@/features/messaging/components/new-message-button'
import { MessageShell } from '@/features/messaging/components/message-shell'
import { getConversationInbox } from '@/features/messaging/queries'
import { getNetworkHub } from '@/features/network/queries'

export default async function MessagesPage() {
  const [viewer, inbox, connections] = await Promise.all([
    requireAwsUser(),
    getConversationInbox({ limit: 100 }),
    getNetworkHub('connections'),
  ])
  const unreadCount = inbox.filter((item) => item.unread).length

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-mist-100 bg-white p-3 shadow-sm">
        <p className="text-sm font-semibold text-navy-950">{unreadCount ? `${unreadCount} unread conversation${unreadCount === 1 ? '' : 's'}` : 'You are all caught up.'}</p>
        <NewMessageButton candidates={connections.profiles} />
      </div>
      <MessageShell
        viewerId={viewer.id}
        inbox={inbox}
        activeConversation={null}
      />
    </div>
  )
}
