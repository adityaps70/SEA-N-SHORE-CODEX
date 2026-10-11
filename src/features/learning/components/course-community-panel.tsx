'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Lock, MessagesSquare, Save } from 'lucide-react'
import { primaryButtonClass, textLinkClass } from '@/components/ui/interactive-styles'
import { linkCourseCommunity } from '../course-community-actions'
import type { CourseCommunityLink } from '../course-community-repository'

/**
 * Learning round C (C7): link the live course to one community the trainer runs (owner or admin). Learners then
 * get "Ask the trainer / Discuss" in the player; a private community opens to them while they are enrolled.
 */
export function CourseCommunityPanel({ link }: { link: CourseCommunityLink }) {
  const [saved, setSaved] = useState<string | null>(link.current?.id ?? null)
  const [choice, setChoice] = useState<string>(link.current?.id ?? '')
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  // The current community stays in the list even if the trainer no longer runs it, so the select shows the truth.
  type Option = CourseCommunityLink['options'][number] & { unavailable?: string }
  const options: Option[] = link.current && !link.options.some((option) => option.id === link.current!.id)
    ? [{ ...link.current, unavailable: link.current.archived ? 'archived' : 'you no longer run it' }, ...link.options]
    : link.options
  const selected = options.find((option) => option.id === saved) ?? null

  function save() {
    setMessage(null)
    const groupId = choice || null
    startTransition(async () => {
      const result = await linkCourseCommunity(link.liveCourseId, groupId)
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error })
        return
      }
      setSaved(result.groupId)
      setMessage({ tone: 'success', text: result.groupId ? 'Community linked. Learners now see “Ask the trainer / Discuss” in the course.' : 'The course is no longer linked to a community.' })
    })
  }

  return (
    <section aria-labelledby="course-community-heading" className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] max-md:rounded-none max-md:border-x-0 max-md:p-4 max-md:shadow-none sm:p-8">
      <h2 id="course-community-heading" className="flex items-center gap-2 text-section-title font-bold text-navy-950 max-md:text-xl">
        <MessagesSquare aria-hidden="true" className="size-5 text-teal-700" /> Course community
      </h2>
      <p className="mt-1 text-meta font-semibold text-navy-800">Discuss the course in a Sea N Shore community</p>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        Link this course to a Sea N Shore community you run, so learners can ask you questions and talk to each other.
        If the community is private, enrolled learners are let in when they open it from the course, and they stay members after their access ends.
      </p>

      {options.length === 0 ? (
        <p className="mt-4 rounded-xl bg-mist-50 px-4 py-3 text-sm leading-6 text-navy-900">
          You don’t run a community yet. <Link href="/community/new" className={textLinkClass}>Start one</Link>, then come back to link it here.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1 text-sm font-bold text-navy-950">
            Community
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              disabled={pending}
              className="mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 text-[15px] font-normal text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-mist-50"
            >
              <option value="">None</option>
              {options.map((option) => (
                <option key={option.id} value={option.id} disabled={Boolean(option.unavailable)}>
                  {option.name}{option.visibility === 'private' ? ' (private)' : ''}{option.unavailable ? ` (${option.unavailable})` : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={save} disabled={pending || (choice || null) === saved} className={`${primaryButtonClass} min-h-11 max-md:w-full`}>
            <Save aria-hidden="true" className="size-4" /> {pending ? 'Saving…' : 'Save community'}
          </button>
        </div>
      )}

      {selected ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-navy-900">
          {selected.visibility === 'private' ? <Lock aria-hidden="true" className="size-4 text-muted" /> : null}
          Linked to <Link href={`/community/${selected.slug}`} className={textLinkClass}>{selected.name}</Link>
        </p>
      ) : null}
      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm font-semibold ${message.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
