'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { searchMentionCandidates, type MentionCandidate } from '../mention-actions'

export type SelectedMention = { profileId: string; label: string }

export function MentionInput({
  id,
  name,
  value,
  onChange,
  mentions,
  onMentionsChange,
  placeholder,
  rows = 3,
  className = '',
}: {
  id: string
  name: string
  value: string
  onChange(value: string): void
  mentions: SelectedMention[]
  onMentionsChange(mentions: SelectedMention[]): void
  placeholder: string
  rows?: number
  className?: string
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [candidates, setCandidates] = useState<MentionCandidate[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [queryState, setQueryState] = useState<{ query: string; start: number; end: number } | null>(null)

  const activeLabels = useMemo(() => new Set(mentions.map((mention) => `@${mention.label}`)), [mentions])

  useEffect(() => {
    const next = mentions.filter((mention) => value.includes(`@${mention.label}`))
    if (next.length !== mentions.length) onMentionsChange(next)
  }, [value, mentions, onMentionsChange])

  useEffect(() => {
    if (!queryState) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void searchMentionCandidates(queryState.query).then((results) => {
        if (cancelled) return
        setCandidates(results)
        setActiveIndex(0)
      })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [queryState])

  function findQuery(text: string, cursor: number) {
    const before = text.slice(0, cursor)
    const match = before.match(/(?:^|\s)@([^@\s]{0,40})$/)
    if (!match || match.index === undefined) return null
    const at = before.lastIndexOf('@')
    if (at < 0) return null
    return { query: match[1] ?? '', start: at, end: cursor }
  }

  function setActiveQuery(next: { query: string; start: number; end: number } | null) {
    setQueryState(next)
    if (!next) setCandidates([])
  }

  function update(text: string, cursor: number) {
    onChange(text)
    setActiveQuery(findQuery(text, cursor))
  }

  function select(candidate: MentionCandidate) {
    if (!queryState) return
    const inserted = `@${candidate.fullName}`
    const next = `${value.slice(0, queryState.start)}${inserted} ${value.slice(queryState.end)}`
    onChange(next)
    if (!activeLabels.has(inserted)) {
      onMentionsChange([...mentions, { profileId: candidate.id, label: candidate.fullName }])
    }
    setActiveQuery(null)
    window.requestAnimationFrame(() => {
      const cursor = queryState.start + inserted.length + 1
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(cursor, cursor)
    })
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        id={id}
        name={name}
        rows={rows}
        value={value}
        onChange={(event) => update(event.target.value, event.target.selectionStart)}
        onClick={(event) => setActiveQuery(findQuery(value, event.currentTarget.selectionStart))}
        onKeyDown={(event) => {
          if (!candidates.length || !queryState) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex((index) => (index + 1) % candidates.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length)
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            const candidate = candidates[activeIndex]
            if (candidate) select(candidate)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setActiveQuery(null)
          }
        }}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-controls={`${id}-mentions`}
        className={className}
      />
      {mentions.map((mention) => <input key={mention.profileId} type="hidden" name="mentionProfileId" value={mention.profileId} />)}
      {candidates.length ? (
        <div id={`${id}-mentions`} role="listbox" className="absolute left-0 top-full z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl border border-mist-100 bg-white p-1.5 shadow-xl">
          {candidates.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(candidate)}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left ${index === activeIndex ? 'bg-ocean-50' : 'hover:bg-mist-50'}`}
            >
              <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-mist-100 text-xs font-semibold text-navy-950">
                {candidate.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={candidate.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : candidate.fullName.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-navy-950">{candidate.fullName}</span>
                <span className="block truncate text-xs text-muted">{candidate.rank ?? candidate.headline ?? candidate.currentCompany ?? 'Maritime professional'}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
