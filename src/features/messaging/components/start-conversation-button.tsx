'use client'

import { MessageCircleMore } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { startDirectConversationAction } from '../actions'

export function StartConversationButton({
  targetProfileId,
  className = '',
}: {
  targetProfileId: string
  className?: string
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
        className={`inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition hover:bg-navy-900 disabled:cursor-wait disabled:opacity-70 ${className}`}
      >
        <MessageCircleMore aria-hidden="true" className="size-4" />
        {pending ? 'Opening…' : 'Message'}
      </button>
      {error ? <p role="alert" className="mt-2 text-xs leading-5 text-red-700">{error}</p> : null}
    </div>
  )
}
