'use client'

import Link from 'next/link'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { MessagingInboxItem } from '../queries'

function initials(name: string | null) {
  if (!name) return 'SN'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function relativeTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const now = new Date()
  const diffMinutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000))
  if (diffMinutes < 1) return 'Now'
  if (diffMinutes < 60) return `${diffMinutes}m`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d`
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function ConversationList({
  inbox,
  activeConversationId,
}: {
  inbox: MessagingInboxItem[]
  activeConversationId?: string | null
}) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!normalizedQuery) return inbox
    return inbox.filter((item) => [item.otherName, item.otherHeadline, item.lastMessageBody]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery)))
  }, [inbox, normalizedQuery])

  return (
    <aside className="flex min-h-0 flex-col border-r border-mist-100 bg-white">
      <div className="border-b border-mist-100 p-4">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label="Search conversations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search messages"
            className="min-h-11 w-full rounded-xl border border-mist-100 bg-mist-50 py-2 pl-9 pr-3 text-sm text-navy-950 outline-none placeholder:text-muted focus:border-teal-500"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.length ? (
          <div className="space-y-1">
            {filtered.map((item) => {
              const name = item.otherName ?? 'Sea N Shore member'
              const selected = item.conversationId === activeConversationId
              return (
                <Link
                  key={item.conversationId}
                  href={`/messages/${item.conversationId}`}
                  aria-label={`Open conversation with ${name}`}
                  className={`flex min-h-20 items-start gap-3 rounded-2xl p-3 transition ${selected ? 'bg-ocean-50' : 'hover:bg-mist-50'}`}
                >
                  {item.otherAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed profile media URL
                    <img
                      src={item.otherAvatarUrl}
                      alt=""
                      className="size-11 shrink-0 rounded-2xl object-cover ring-1 ring-mist-100"
                    />
                  ) : (
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,var(--mist-100),white)] text-xs font-bold text-navy-950 ring-1 ring-mist-100">
                      {initials(item.otherName)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={`truncate text-sm ${item.unread ? 'font-bold text-navy-950' : 'font-semibold text-navy-900'}`}>
                        {name}{item.unread ? ' · New' : ''}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted">{relativeTime(item.lastMessageAt)}</span>
                    </span>
                    {item.otherHeadline ? (
                      <span className="mt-0.5 block truncate text-xs text-muted">{item.otherHeadline}</span>
                    ) : null}
                    <span className={`mt-1 block truncate text-xs ${item.unread ? 'font-semibold text-navy-900' : 'text-muted'}`}>
                      {item.lastMessageBody ? `Last: ${item.lastMessageBody}` : 'Start the conversation'}
                    </span>
                  </span>
                  {item.unread ? (
                    <span
                      aria-label={`Unread conversation with ${name}`}
                      className="mt-8 size-2 shrink-0 rounded-full bg-ocean-600"
                    />
                  ) : null}
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="grid min-h-44 place-items-center px-4 text-center">
            <div>
              <p className="text-sm font-semibold text-navy-950">No conversations found</p>
              <p className="mt-1 text-xs leading-5 text-muted">Try another name, role or message keyword.</p>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
