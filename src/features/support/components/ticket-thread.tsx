import type { SupportTicketMessage } from '../repository'

const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

export function formatSupportDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : `${dateFormat.format(date)} IST`
}

function authorLabel(message: SupportTicketMessage, viewer: 'member' | 'admin', senderName: string) {
  if (message.authorRole === 'admin') return viewer === 'admin' && message.authorName ? `Sea N Shore support · ${message.authorName}` : 'Sea N Shore support'
  if (viewer === 'member') return 'You'
  return `${senderName || 'Sender'}${message.authorRole === 'visitor' ? ' (visitor)' : ''}`
}

/**
 * Round H (H7): a ticket's messages, oldest first, as an ordered list. Members see "You" and
 * "Sea N Shore support"; administrators also see which administrator answered.
 */
export function TicketThread({ messages, viewer, senderName = '' }: { messages: SupportTicketMessage[]; viewer: 'member' | 'admin'; senderName?: string }) {
  return (
    <ol aria-label="Messages" className="grid gap-3">
      {messages.map((message) => (
        <li
          key={message.id}
          className={`rounded-2xl border p-4 ${message.authorRole === 'admin' ? 'border-ocean-100 bg-ocean-50/50' : 'border-mist-100 bg-white'}`}
        >
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold text-navy-950">{authorLabel(message, viewer, senderName)}</span>
            <time dateTime={message.createdAt} className="text-xs text-muted">{formatSupportDate(message.createdAt)}</time>
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-navy-900 max-md:text-base">{message.body}</p>
        </li>
      ))}
    </ol>
  )
}
