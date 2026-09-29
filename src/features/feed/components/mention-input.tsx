'use client'

import { Building2, Hash } from 'lucide-react'
import { MediaImage } from '@/components/ui/media-image'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { searchHashtags } from '@/features/hashtags/actions'
import { activeHashtagQuery } from '@/features/hashtags/parse'
import { searchMentionCandidates, type MentionCandidate } from '../mention-actions'

export type SelectedMention = {
  /** A member (the default, for existing callers and saved drafts) or an organization page. */
  kind?: 'member' | 'organization'
  /** The member's profile id, or the company id for an organization. */
  profileId: string
  /** The name as inserted after "@"; the mention is dropped when it leaves the text. */
  label: string
  /** Organizations only: lets the post render its link straight after an edit. */
  slug?: string
  logoUrl?: string | null
}

export function mentionKind(mention: SelectedMention): 'member' | 'organization' {
  return mention.kind === 'organization' ? 'organization' : 'member'
}

function candidateLabel(candidate: MentionCandidate) {
  return candidate.kind === 'organization' ? candidate.name : candidate.fullName
}

type HashtagSuggestion = { kind: 'hashtag'; tag: string; postCount: number }
type Suggestion = MentionCandidate | HashtagSuggestion
type ActiveQuery = { kind: 'mention' | 'hashtag'; query: string; start: number; end: number }

function suggestionKey(suggestion: Suggestion) {
  return suggestion.kind === 'hashtag' ? `hashtag-${suggestion.tag}` : `${suggestion.kind === 'organization' ? 'organization' : 'member'}-${suggestion.id}`
}

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
  textareaRef: externalTextareaRef,
  maxLength,
  describedBy,
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
  /** Lets the parent read the caret, e.g. to insert an emoji where the member is typing. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  maxLength?: number
  describedBy?: string
}) {
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = externalTextareaRef ?? internalTextareaRef
  const [candidates, setCandidates] = useState<Suggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [queryState, setQueryState] = useState<ActiveQuery | null>(null)

  const activeLabels = useMemo(() => new Set(mentions.map((mention) => `@${mention.label}`)), [mentions])

  useEffect(() => {
    const next = mentions.filter((mention) => value.includes(`@${mention.label}`))
    if (next.length !== mentions.length) onMentionsChange(next)
  }, [value, mentions, onMentionsChange])

  useEffect(() => {
    if (!queryState) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      const request: Promise<Suggestion[]> = queryState.kind === 'hashtag'
        ? searchHashtags(queryState.query).then((results) => results.map((result) => ({ kind: 'hashtag' as const, tag: result.tag, postCount: result.postCount })))
        : searchMentionCandidates(queryState.query)
      void request.then((results) => {
        if (cancelled) return
        setCandidates(results)
        setActiveIndex(0)
      }).catch(() => {
        if (!cancelled) setCandidates([])
      })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [queryState])

  /** The "@name" or "#tag" the caret is typing, if any. Mentions are checked first. */
  function findQuery(text: string, cursor: number): ActiveQuery | null {
    const before = text.slice(0, cursor)
    const match = before.match(/(?:^|\s)@([^@\s]{0,40})$/)
    if (match && match.index !== undefined) {
      const at = before.lastIndexOf('@')
      if (at >= 0) return { kind: 'mention', query: match[1] ?? '', start: at, end: cursor }
    }
    const hashtag = activeHashtagQuery(text, cursor)
    if (hashtag && hashtag.query.length <= 64) return { kind: 'hashtag', query: hashtag.query, start: hashtag.start, end: cursor }
    return null
  }

  function setActiveQuery(next: ActiveQuery | null) {
    setQueryState(next)
    if (!next) setCandidates([])
  }

  function update(text: string, cursor: number) {
    onChange(text)
    setActiveQuery(findQuery(text, cursor))
  }

  function select(candidate: Suggestion) {
    if (!queryState) return
    const inserted = candidate.kind === 'hashtag' ? `#${candidate.tag}` : `@${candidateLabel(candidate)}`
    const next = `${value.slice(0, queryState.start)}${inserted} ${value.slice(queryState.end)}`
    onChange(next)
    if (candidate.kind !== 'hashtag' && !activeLabels.has(inserted)) {
      const label = candidateLabel(candidate)
      onMentionsChange([
        ...mentions,
        candidate.kind === 'organization'
          ? { kind: 'organization', profileId: candidate.id, label, slug: candidate.slug, logoUrl: candidate.logoUrl }
          : { kind: 'member', profileId: candidate.id, label },
      ])
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
        aria-describedby={describedBy}
        maxLength={maxLength}
        className={className}
      />
      {mentions.map((mention) => (
        <input
          key={`${mentionKind(mention)}-${mention.profileId}`}
          type="hidden"
          name={mentionKind(mention) === 'organization' ? 'organizationMentionId' : 'mentionProfileId'}
          value={mention.profileId}
        />
      ))}
      {candidates.length ? (
        <div id={`${id}-mentions`} role="listbox" className="absolute left-0 top-full z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl border border-mist-100 bg-white p-1.5 shadow-xl">
          {candidates.map((candidate, index) => (
            <button
              key={suggestionKey(candidate)}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              data-kind={candidate.kind === 'hashtag' ? 'hashtag' : candidate.kind === 'organization' ? 'organization' : 'member'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(candidate)}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left ${index === activeIndex ? 'bg-ocean-50' : 'hover:bg-mist-50'}`}
            >
              {candidate.kind === 'hashtag' ? (
                <>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ocean-50 text-ocean-700">
                    <Hash aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-navy-950">#{candidate.tag}</span>
                    <span className="block truncate text-xs text-muted">{candidate.postCount === 1 ? '1 post' : `${candidate.postCount.toLocaleString('en')} posts`}</span>
                  </span>
                </>
              ) : candidate.kind === 'organization' ? (
                <>
                  <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-navy-950 text-white">
                    {candidate.logoUrl ? (
                      <MediaImage src={candidate.logoUrl} alt="" fill sizes="32px" className="bg-white object-contain" fallback={<Building2 aria-hidden="true" className="size-4" />} />
                    ) : <Building2 aria-hidden="true" className="size-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-navy-950">{candidate.name}</span>
                    <span className="block truncate text-xs text-muted">
                      <span className="font-semibold text-ocean-700">Organization</span>
                      {candidate.subtitle ? ` · ${candidate.subtitle}` : ''}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-mist-100 text-xs font-semibold text-navy-950">
                    {candidate.avatarUrl ? (
                      <MediaImage avatar src={candidate.avatarUrl} alt="" fill sizes="32px" className="object-cover" fallback={candidate.fullName.slice(0, 1).toUpperCase()} />
                    ) : candidate.fullName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-navy-950">{candidate.fullName}</span>
                    <span className="block truncate text-xs text-muted">{candidate.rank ?? candidate.headline ?? candidate.currentCompany ?? 'Maritime professional'}</span>
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
