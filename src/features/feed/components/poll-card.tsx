'use client'

import { useMemo, useState, useTransition } from 'react'
import { setPollVote } from '../actions'
import type { FeedPoll, FeedPollOption } from '../types'

export function PollCard({ postId, poll }: { postId: string; poll: FeedPoll }) {
  const [options, setOptions] = useState<FeedPollOption[]>(poll.options)
  const [selected, setSelected] = useState<string | null>(poll.viewerOptionId)
  const [choice, setChoice] = useState<string | null>(poll.viewerOptionId)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const totalVotes = useMemo(() => options.reduce((sum, option) => sum + option.voteCount, 0), [options])

  function vote() {
    if (!choice || choice === selected) return
    const previous = selected
    setError('')
    startTransition(async () => {
      const result = await setPollVote(postId, choice)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOptions((current) => current.map((option) => {
        if (previous && option.id === previous) return { ...option, voteCount: Math.max(0, option.voteCount - 1) }
        if (option.id === choice) return { ...option, voteCount: option.voteCount + 1 }
        return option
      }))
      setSelected(choice)
    })
  }

  return (
    <fieldset className="mt-4 rounded-2xl border border-mist-100 bg-mist-50/50 p-4">
      <legend className="px-1 text-sm font-semibold text-navy-950">Technical poll</legend>
      <div className="mt-2 space-y-2">
        {options.map((option) => {
          const percentage = totalVotes ? Math.round((option.voteCount / totalVotes) * 100) : 0
          return (
            <label key={option.id} className="relative flex min-h-12 cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-navy-900">
              {selected ? <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-mist-50" style={{ width: `${percentage}%` }} /> : null}
              <input
                type="radio"
                name={`poll-${postId}`}
                value={option.id}
                checked={choice === option.id}
                onChange={() => setChoice(option.id)}
                className="relative z-10"
              />
              <span className="relative z-10 flex-1 font-medium">{option.label}</span>
              {selected ? <span className="relative z-10 text-xs font-semibold text-muted">{percentage}% · {option.voteCount}</span> : null}
            </label>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={!choice || choice === selected || pending}
          onClick={vote}
          className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Voting…' : selected ? 'Change vote' : 'Vote'}
        </button>
        {selected ? <span className="text-xs text-muted">{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span> : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
    </fieldset>
  )
}
