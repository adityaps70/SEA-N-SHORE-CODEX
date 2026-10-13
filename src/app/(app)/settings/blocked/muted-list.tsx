'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Loader2, VolumeX } from 'lucide-react'
import { unmuteAction } from '@/features/signals/actions'

export type MutedItem = {
  id: string
  kind: 'person' | 'org'
  name: string
  slug: string | null
  subtitle: string | null
  mutedOn: string
}

function MutedRow({ item }: { item: MutedItem }) {
  const [pending, startTransition] = useTransition()
  const [unmuted, setUnmuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const href = item.slug ? (item.kind === 'person' ? `/people/${item.slug}` : `/organizations/${item.slug}`) : null

  function onUnmute() {
    setError(null)
    startTransition(async () => {
      const result = await unmuteAction(item.id)
      if (result.ok) setUnmuted(true)
      else setError(result.error)
    })
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-mist-100 text-navy-950">
        <VolumeX className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className="block truncate text-[15px] font-semibold text-navy-950 hover:text-ocean-700 hover:underline">{item.name}</Link>
        ) : <p className="truncate text-[15px] font-semibold text-navy-950">{item.name}</p>}
        {item.subtitle ? <p className="truncate text-sm text-muted">{item.subtitle}</p> : null}
        <p className="text-xs text-muted">{unmuted ? 'Unmuted' : `${item.kind === 'person' ? 'Member' : 'Organization'} · muted ${item.mutedOn}`}</p>
        {error ? <p role="alert" className="mt-1 text-sm font-medium text-red-700">{error}</p> : null}
      </div>
      {unmuted ? (
        <span role="status" className="shrink-0 text-sm font-semibold text-teal-700">Unmuted</span>
      ) : (
        <button
          type="button"
          onClick={onUnmute}
          disabled={pending}
          aria-label={`Unmute ${item.name}`}
          className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-ocean-700 px-4 text-sm font-semibold text-ocean-700 transition hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          Unmute
        </button>
      )}
    </li>
  )
}

/** Settings › Blocked & muted: members and organizations whose posts the viewer muted (round G). */
export function MutedList({ items }: { items: MutedItem[] }) {
  if (!items.length) {
    return <p className="px-5 py-8 text-center text-sm text-muted">You haven’t muted anyone. Use “Mute” in a post’s ⋯ menu to hide someone’s posts without blocking them.</p>
  }
  return (
    <ul className="divide-y divide-mist-100" aria-label="Muted members and organizations">
      {items.map((item) => <MutedRow key={item.id} item={item} />)}
    </ul>
  )
}
