'use client'

import { MessageSquarePlus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { NetworkProfile } from '@/features/network/types'
import { StartConversationButton } from './start-conversation-button'

export function NewMessageButton({ candidates }: { candidates: NetworkProfile[] }) {
  const [open, setOpen] = useState(false)
  const [recipientId, setRecipientId] = useState('')
  const recipient = useMemo(
    () => candidates.find((candidate) => candidate.id === recipientId) ?? null,
    [candidates, recipientId],
  )

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-navy-900"
        aria-expanded={open}
      >
        <MessageSquarePlus aria-hidden="true" className="size-4" /> New Message
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-mist-100 bg-white p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-sm font-bold text-navy-950">Choose a recipient</p><p className="mt-1 text-xs leading-5 text-muted">Start a conversation with one of your accepted maritime connections.</p></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close recipient picker" className="grid size-8 place-items-center rounded-full hover:bg-mist-50"><X aria-hidden="true" className="size-4" /></button>
          </div>

          {candidates.length ? (
            <>
              <label className="mt-4 block text-xs font-bold text-navy-950">Recipient
                <select value={recipientId} onChange={(event) => setRecipientId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink">
                  <option value="">Select a connection</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.fullName}{candidate.rank ? ` · ${candidate.rank}` : candidate.currentCompany ? ` · ${candidate.currentCompany}` : ''}</option>
                  ))}
                </select>
              </label>
              {recipient ? (
                <div className="mt-3 rounded-xl bg-mist-50 p-3">
                  <p className="text-sm font-bold text-navy-950">{recipient.fullName}</p>
                  <p className="mt-0.5 text-xs text-muted">{[recipient.rank, recipient.currentCompany].filter(Boolean).join(' · ') || recipient.headline || `@${recipient.slug}`}</p>
                  <StartConversationButton targetProfileId={recipient.id} className="mt-3" />
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-4 rounded-xl bg-mist-50 p-3 text-sm leading-6 text-muted">Connect with maritime professionals first, then you can start a private conversation here.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
