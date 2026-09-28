'use client'

import { MessageCircleMore } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { startDirectConversationAction } from '../actions'

export function StartConversationButton({
  targetProfileId,
  className = '',
  variant = 'default',
}: {
  targetProfileId: string
  className?: string
  /** `pill`: compact ocean outline pill for list rows (phone search results). */
  variant?: 'default' | 'pill'
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function openConversation() {
    setError(null)
    startTransition(async () => {
      const result = await startDirectConversationAction(targetProfileId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(`/messages/${result.conversationId}`)
    })
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={openConversation}
        disabled={pending}
        className={variant === 'pill'
          ? `relative inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-ocean-700 bg-white px-3.5 text-[13px] font-semibold text-ocean-700 transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-wait disabled:opacity-70 ${className}`
          : `inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition hover:bg-navy-900 disabled:cursor-wait disabled:opacity-70 ${className}`}
      >
        <MessageCircleMore aria-hidden="true" className="size-4" />
        {pending ? 'Opening…' : 'Message'}
      </button>
      {error ? <p role="alert" className="mt-2 text-xs leading-5 text-red-700">{error}</p> : null}
    </div>
  )
}
