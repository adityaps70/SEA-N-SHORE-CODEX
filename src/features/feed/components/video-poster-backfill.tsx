'use client'

import { useState } from 'react'
import { createPostVideoPosterUpload } from '../actions'
import { uploadVideoPoster } from '../video-poster'
import { feedVideoPosterUrl, feedVideoStoragePath } from './feed-video'

type Progress = { checked: number; made: number; failed: number; skipped: number }

/** One video at a time, so the browser never decodes several large files at once. */
export function VideoPosterBackfill({ videoUrls }: { videoUrls: string[] }) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)

  async function run() {
    setRunning(true)
    const totals: Progress = { checked: 0, made: 0, failed: 0, skipped: 0 }
    setProgress({ ...totals })
    for (const url of videoUrls) {
      const posterUrl = feedVideoPosterUrl(url)
      const storagePath = feedVideoStoragePath(url)
      totals.checked += 1
      if (!posterUrl || !storagePath) {
        totals.failed += 1
      } else {
        const existing = await fetch(posterUrl, { method: 'HEAD', redirect: 'manual', cache: 'no-store' }).catch(() => null)
        if (existing && existing.status !== 404) {
          totals.skipped += 1
        } else {
          const ok = await uploadVideoPoster({
            videoStoragePath: storagePath,
            source: `${url}?source=poster`,
            createUpload: (input) => createPostVideoPosterUpload(input),
          })
          if (ok) totals.made += 1
          else totals.failed += 1
        }
      }
      setProgress({ ...totals })
    }
    setRunning(false)
  }

  if (!videoUrls.length) return <p className="text-sm text-muted">There are no posted videos.</p>

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        className="inline-flex min-h-11 items-center rounded-lg bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900 disabled:opacity-60"
      >
        {running ? 'Making posters…' : 'Make missing posters'}
      </button>
      {progress ? (
        <p role="status" aria-live="polite" className="text-sm text-navy-900">
          Checked {progress.checked} of {videoUrls.length}: {progress.made} made, {progress.skipped} already had one, {progress.failed} could not be made.
        </p>
      ) : null}
    </div>
  )
}
