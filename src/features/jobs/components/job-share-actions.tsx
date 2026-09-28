'use client'

import { Link2, Share2 } from 'lucide-react'
import { useState } from 'react'
import { SHARE_OUTCOME_MESSAGE, copyText, jobShareUrl, shareLink } from '../share'

const BUTTON_CLASS =
  'inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'

/** Share and Copy link for a job (desktop detail actions; phones use the "…" sheet). */
export function JobShareActions({ jobId, jobTitle, companyName }: { jobId: string; jobTitle: string; companyName: string }) {
  const [message, setMessage] = useState('')

  async function share() {
    const outcome = await shareLink({ title: jobTitle, text: `${jobTitle} at ${companyName} on Sea N Shore`, url: jobShareUrl(jobId) })
    setMessage(SHARE_OUTCOME_MESSAGE[outcome])
  }

  async function copy() {
    setMessage((await copyText(jobShareUrl(jobId))) ? 'Link copied.' : SHARE_OUTCOME_MESSAGE.failed)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={share} className={BUTTON_CLASS}><Share2 aria-hidden="true" className="size-4" />Share</button>
        <button type="button" onClick={copy} className={BUTTON_CLASS}><Link2 aria-hidden="true" className="size-4" />Copy link</button>
      </div>
      <p role="status" className="mt-1 min-h-4 text-xs font-medium text-muted">{message}</p>
    </div>
  )
}
