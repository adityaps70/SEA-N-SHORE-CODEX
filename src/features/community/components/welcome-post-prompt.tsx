'use client'

import { MessageSquarePlus, X } from 'lucide-react'
import { useSyncExternalStore, useState } from 'react'
import { Button } from '@/components/ui/button'
import { iconButtonClass } from '@/components/ui/interactive-styles'
import { requestComposerPrefill } from '@/features/feed/compose-request'
import { WELCOME_STARTER_QUESTIONS, welcomePostTemplate } from '../welcome-post'

function dismissalKey(groupId: string) {
  return `sea-n-shore:community-welcome-dismissed:${groupId}`
}

function readDismissed(groupId: string) {
  try {
    return window.localStorage.getItem(dismissalKey(groupId)) === '1'
  } catch {
    return false
  }
}

const subscribeNever = () => () => {}

/**
 * Round H (H7): asks a new community's owner to write a welcome post with three starter questions. "Write the
 * welcome post" opens the community composer with the template in it. Dismissing it is remembered on this device.
 */
export function WelcomePostPrompt({ group }: { group: { id: string; name: string; description?: string | null } }) {
  const storedDismissed = useSyncExternalStore(subscribeNever, () => readDismissed(group.id), () => true)
  const [dismissed, setDismissed] = useState(false)
  if (storedDismissed || dismissed) return null

  function dismiss() {
    setDismissed(true)
    try {
      window.localStorage.setItem(dismissalKey(group.id), '1')
    } catch {
      // Private mode: the card stays hidden until the page reloads.
    }
  }

  return (
    <section aria-labelledby={`welcome-prompt-${group.id}`} className="relative rounded-2xl border border-ocean-100 bg-ocean-50/60 p-5 pr-12 max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:px-4 max-md:pr-12">
      <button type="button" onClick={dismiss} aria-label="Dismiss the welcome post suggestion" className={`${iconButtonClass} absolute right-2 top-2 max-md:size-11`}>
        <X aria-hidden="true" className="size-4" />
      </button>
      <h2 id={`welcome-prompt-${group.id}`} className="flex items-center gap-2 text-base font-bold text-navy-950">
        <MessageSquarePlus aria-hidden="true" className="size-5 shrink-0 text-ocean-700" />
        Welcome your first members
      </h2>
      <p className="mt-1 text-sm leading-6 text-ink">
        Start {group.name} with a welcome post and three starter questions. We fill in a draft you can edit before posting:
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-muted">
        {WELCOME_STARTER_QUESTIONS.map((question) => <li key={question}>{question}</li>)}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => requestComposerPrefill({ groupId: group.id, body: welcomePostTemplate(group) })}>
          Write the welcome post
        </Button>
        <Button size="sm" variant="secondary" onClick={dismiss}>Not now</Button>
      </div>
    </section>
  )
}
