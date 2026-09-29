'use client'

import Link from 'next/link'
import { MailOpen, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { MessagingInboxItem } from '../queries'
import { ConversationActionsMenu, type DeletedConversationResult } from './conversation-actions'

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

const ROW_MENU_TRIGGER_CLASS = 'grid size-8 cursor-pointer place-items-center rounded-full border border-mist-100 bg-white text-navy-900 shadow-sm transition hover:border-ocean-200 hover:bg-ocean-50 hover:text-ocean-800 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600 aria-expanded:opacity-100 aria-expanded:bg-ocean-50 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100'

export function ConversationList({
  inbox,
  activeConversationId,
  onConversationDeleted,
}: {
  inbox: MessagingInboxItem[]
  activeConversationId?: string | null
  onConversationDeleted?: (result: DeletedConversationResult) => void
}) {
  const [query, setQuery] = useState('')
  /** Phone chips: All · Unread. Organization/job chips need conversation context the inbox does not carry yet. */
  const [phoneFilter, setPhoneFilter] = useState<'all' | 'unread'>('all')
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!normalizedQuery) return inbox
    return inbox.filter((item) => [item.otherName, item.otherHeadline, item.lastMessageBody]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery)))
  }, [inbox, normalizedQuery])
  const phoneEmptyUnread = phoneFilter === 'unread' && filtered.length > 0 && !filtered.some((item) => item.unread)

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-mist-100 bg-white max-md:border-r-0 max-md:bg-transparent">
      <div className="border-b border-mist-100 p-4 max-md:border-b-0 max-md:px-0 max-md:pb-2 max-md:pt-1">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label="Search conversations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search messages"
            className="min-h-11 w-full rounded-xl border border-mist-100 bg-mist-50 py-2 pl-9 pr-3 text-sm text-navy-950 outline-none placeholder:text-muted focus:border-teal-500 max-md:border-transparent max-md:bg-mist-100 max-md:text-base"
          />
        </div>
        <div role="group" aria-label="Filter conversations" className="mt-3 flex gap-2 overflow-x-auto md:hidden">
          {(['all', 'unread'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={phoneFilter === value}
              onClick={() => setPhoneFilter(value)}
              className="inline-flex min-h-8 shrink-0 cursor-pointer items-center rounded-full border border-mist-300 bg-white px-3.5 text-sm font-semibold text-navy-700 hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 aria-pressed:border-navy-950 aria-pressed:bg-navy-950 aria-pressed:text-white"
            >
              {value === 'all' ? 'All' : 'Unread'}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 max-md:-mx-4 max-md:overflow-visible max-md:p-0">
        {phoneEmptyUnread ? (
          <div role="status" className="px-6 py-12 text-center md:hidden">
            <MailOpen aria-hidden="true" className="mx-auto size-7 text-muted" />
            <p className="mt-3 text-[15px] font-medium text-navy-950">You have read every conversation.</p>
            <button type="button" onClick={() => setPhoneFilter('all')} className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full border border-ocean-700 px-5 text-[15px] font-semibold text-ocean-700 hover:bg-ocean-50">
              Show all conversations
            </button>
          </div>
        ) : null}
        {filtered.length ? (
          <div className="space-y-1 max-md:space-y-0 max-md:divide-y max-md:divide-mist-100 max-md:border-y max-md:border-mist-100 max-md:bg-white">
            {filtered.map((item, index) => {
              const name = item.otherName ?? 'Sea N Shore member'
              const selected = item.conversationId === activeConversationId
              const openMenuUp = index > 1 && index >= filtered.length - 1
              return (
                <div key={item.conversationId} className={`group relative ${phoneFilter === 'unread' && !item.unread ? 'max-md:hidden' : ''}`}>
                <Link
                  href={`/messages/${item.conversationId}`}
                  aria-label={`Open conversation with ${name}`}
                  aria-current={selected ? 'page' : undefined}
                  className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-2xl p-3 pr-12 transition md:pr-3 max-md:items-center max-md:rounded-none max-md:pl-4 max-md:pr-14 max-md:py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ocean-600 ${selected ? 'bg-ocean-50 hover:bg-ocean-100/70' : 'hover:bg-mist-50'}`}
                >
                  {item.otherAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed profile media URL
                    <img
                      src={item.otherAvatarUrl}
                      alt=""
                      className="size-11 shrink-0 rounded-2xl object-cover ring-1 ring-mist-100 max-md:size-14 max-md:rounded-full"
                    />
                  ) : (
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,var(--mist-100),white)] text-xs font-bold text-navy-950 ring-1 ring-mist-100 max-md:size-14 max-md:rounded-full max-md:bg-ocean-50 max-md:text-base max-md:text-ocean-800 max-md:ring-0">
                      {initials(item.otherName)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={`truncate text-sm max-md:text-base ${item.unread ? 'font-bold text-navy-950' : 'font-semibold text-navy-900'}`}>
                        {name}{item.unread ? <span className="max-md:sr-only"> · New</span> : null}
                      </span>
                      <span className={`shrink-0 text-[11px] text-muted ${onConversationDeleted ? 'md:group-focus-within:invisible md:group-hover:invisible' : ''}`}>{relativeTime(item.lastMessageAt)}</span>
                    </span>
                    {item.otherHeadline ? (
                      <span className="mt-0.5 block truncate text-xs text-muted max-md:hidden">{item.otherHeadline}</span>
                    ) : null}
                    <span className={`mt-1 block truncate text-xs max-md:mt-0.5 max-md:text-sm ${item.unread ? 'font-semibold text-navy-900' : 'text-muted'}`}>
                      {/* Phones show the message alone (the round 8 inbox); desktop keeps the “Last:” label. */}
                      {item.lastMessageBody ? <><span className="max-md:hidden">Last: </span>{item.lastMessageBody}</> : 'Start the conversation'}
                    </span>
                  </span>
                  {item.unread ? (
                    <span
                      aria-label={`Unread conversation with ${name}`}
                      className="mt-8 size-2 shrink-0 rounded-full bg-ocean-600"
                    />
                  ) : null}
                </Link>
                {onConversationDeleted ? (
                  <ConversationActionsMenu
                    conversationId={item.conversationId}
                    otherName={name}
                    onDeleted={onConversationDeleted}
                    direction={openMenuUp ? 'up' : 'down'}
                    className="absolute right-2.5 top-[calc(50%-1rem)] md:top-2"
                    triggerClassName={ROW_MENU_TRIGGER_CLASS}
                  />
                ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid min-h-44 place-items-center px-4 text-center">
            <div>
              {normalizedQuery ? (
                <>
                  <p className="text-sm font-semibold text-navy-950">No conversations found</p>
                  <p className="mt-1 text-xs leading-5 text-muted">Try another name, role or message keyword.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-navy-950">No conversations yet</p>
                  <p className="mt-1 text-xs leading-5 text-muted">Use New Message to write to one of your connections.</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
