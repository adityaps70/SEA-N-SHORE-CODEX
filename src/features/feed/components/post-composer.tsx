'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { BarChart3, ImagePlus, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import type { OwnProfile } from '@/features/profiles/types'
import { createPost, type PostComposerState } from '../actions'
import { POST_CATEGORIES, POST_CATEGORY_LABELS, type PostCategory } from '../types'

const initialState: PostComposerState = {}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

type PollField = { id: string; value: string }

function newPollFields(values: string[] = ['', '']): PollField[] {
  const source = values.length >= 2 ? values.slice(0, 6) : ['', '']
  return source.map((value) => ({ id: crypto.randomUUID(), value }))
}

export function PostComposer({ profile, defaultCategory }: { profile: OwnProfile; defaultCategory?: PostCategory }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const mediaRef = useRef<HTMLInputElement>(null)
  const [state, formAction, pending] = useActionState(createPost, initialState)
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<PostCategory>(defaultCategory ?? 'technical_discussion')
  const [mode, setMode] = useState<'standard' | 'poll'>('standard')
  const [pollFields, setPollFields] = useState<PollField[]>(() => newPollFields())
  const [mediaName, setMediaName] = useState<string | null>(null)

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset()
      setBody('')
      setMode('standard')
      setPollFields(newPollFields())
      setMediaName(null)
      router.refresh()
      return
    }
    if (state.values) {
      if (state.values.body !== undefined) setBody(state.values.body)
      if (state.values.category) setCategory(state.values.category)
      if (state.values.mode) setMode(state.values.mode)
      if (state.values.pollOptions?.length) setPollFields(newPollFields(state.values.pollOptions))
    }
  }, [state, router])

  function chooseMode(nextMode: 'standard' | 'poll') {
    setMode(nextMode)
    if (nextMode === 'poll') {
      if (mediaRef.current) mediaRef.current.value = ''
      setMediaName(null)
    }
  }

  return (
    <Card className="border border-mist-100 p-4 sm:p-5">
      <form ref={formRef} action={formAction} className="space-y-4">
        <input type="hidden" name="mode" value={mode} />
        <div className="flex items-start gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-mist-100 text-sm font-semibold text-navy-950 ring-1 ring-mist-100">
            {initials(profile.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="feed-post-body" className="sr-only">Post to Sea N Shore</label>
            <textarea
              id="feed-post-body"
              name="body"
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Share a maritime update, technical lesson, or industry insight..."
              className="min-h-24 w-full resize-y rounded-2xl border border-mist-100 bg-mist-50/60 px-4 py-3 text-sm leading-6 text-ink outline-none placeholder:text-muted focus:border-ocean-500 focus:bg-white"
              aria-describedby={state.fieldErrors?.body ? 'feed-body-error' : undefined}
            />
            {state.fieldErrors?.body ? <p id="feed-body-error" className="mt-1 text-sm text-red-700">{state.fieldErrors.body[0]}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="text-xs font-semibold uppercase tracking-[.12em] text-muted" htmlFor="feed-category">Topic</label>
          <select
            id="feed-category"
            name="category"
            value={category}
            onChange={(event) => setCategory(event.target.value as PostCategory)}
            className="min-h-10 rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-900"
          >
            {POST_CATEGORIES.map((value) => <option key={value} value={value}>{POST_CATEGORY_LABELS[value]}</option>)}
          </select>
        </div>

        {mode === 'poll' ? (
          <fieldset className="rounded-2xl border border-mist-100 bg-mist-50/50 p-4">
            <legend className="px-1 text-sm font-semibold text-navy-950">Technical poll options</legend>
            <div className="mt-2 space-y-2">
              {pollFields.map((field, index) => (
                <div key={field.id} className="flex gap-2">
                  <label className="sr-only" htmlFor={`poll-option-${field.id}`}>Poll option {index + 1}</label>
                  <input
                    id={`poll-option-${field.id}`}
                    name="pollOption"
                    value={field.value}
                    maxLength={120}
                    onChange={(event) => setPollFields((current) => current.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item))}
                    placeholder={`Option ${index + 1}`}
                    className="min-h-11 flex-1 rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink"
                  />
                  {pollFields.length > 2 ? (
                    <button
                      type="button"
                      onClick={() => setPollFields((current) => current.filter((item) => item.id !== field.id))}
                      className="min-h-11 rounded-xl px-3 text-sm font-semibold text-muted hover:bg-white hover:text-navy-950"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {state.fieldErrors?.pollOptions ? <p className="mt-2 text-sm text-red-700">{state.fieldErrors.pollOptions[0]}</p> : null}
            <button
              type="button"
              disabled={pollFields.length >= 6}
              onClick={() => setPollFields((current) => [...current, { id: crypto.randomUUID(), value: '' }])}
              className="mt-3 min-h-10 rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-ocean-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add option
            </button>
          </fieldset>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-mist-100 pt-3">
          <input
            ref={mediaRef}
            id="post-media"
            name="media"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={mode === 'poll'}
            onChange={(event) => setMediaName(event.target.files?.[0]?.name ?? null)}
          />
          <label
            htmlFor="post-media"
            aria-disabled={mode === 'poll'}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${mode === 'poll' ? 'cursor-not-allowed text-muted opacity-50' : 'cursor-pointer text-navy-900 hover:bg-mist-50'}`}
          >
            <ImagePlus aria-hidden="true" className="size-5 text-ocean-700" />
            Photo/Diagram
          </label>
          <button
            type="button"
            onClick={() => chooseMode(mode === 'poll' ? 'standard' : 'poll')}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${mode === 'poll' ? 'bg-mist-50 text-ocean-700' : 'text-navy-900 hover:bg-mist-50'}`}
          >
            <BarChart3 aria-hidden="true" className="size-5 text-ocean-700" />
            Technical Poll
          </button>
          {mediaName && mode === 'standard' ? (
            <div className="flex min-w-0 items-center gap-2 rounded-xl bg-mist-50 px-3 py-2 text-xs text-muted">
              <span className="max-w-44 truncate">{mediaName}</span>
              <button
                type="button"
                className="font-semibold text-navy-900"
                onClick={() => {
                  if (mediaRef.current) mediaRef.current.value = ''
                  setMediaName(null)
                }}
              >
                Remove
              </button>
            </div>
          ) : null}
          {mediaName && mode === 'standard' ? (
            <label className="w-full text-sm text-muted">
              <span className="sr-only">Image description</span>
              <input name="altText" maxLength={300} placeholder="Optional image description for accessibility" className="min-h-10 w-full rounded-xl border border-mist-100 bg-mist-50 px-3 text-sm text-ink" />
            </label>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send aria-hidden="true" className="size-4" />
            {pending ? 'Posting…' : 'Post'}
          </button>
        </div>

        {state.error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      </form>
    </Card>
  )
}
