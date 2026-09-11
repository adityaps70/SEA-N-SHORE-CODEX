'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveHiringRecruiterNote } from '../hiring-actions'

export function RecruiterNoteForm({ applicationId }: { applicationId: string }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    const value = note.trim()
    if (!value) {
      setError('Add a note before saving.')
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await saveHiringRecruiterNote(applicationId, value)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNote('')
      router.refresh()
    })
  }

  return (
    <div>
      <label className="block">
        <span className="text-sm font-bold text-navy-950">Add private note</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={4000}
          rows={4}
          placeholder="Visible only inside the Hiring workspace. Capture screening context, follow-ups or interview preparation."
          className="mt-2 w-full rounded-xl border border-mist-200 bg-white px-3 py-2.5 text-sm text-navy-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
        />
      </label>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">Private to authorised company hiring members.</p>
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save note'}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm font-semibold text-rose-700">{error}</p> : null}
    </div>
  )
}
