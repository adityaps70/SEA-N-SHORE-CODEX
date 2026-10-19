'use client'

import { CheckCircle2, ClipboardCopy, Download, Images, Send, Share2, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { BottomSheet } from '@/components/ui/mobile-sheet'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import { postPath } from '@/features/feed/post-seo'
import { copyText } from '@/features/jobs/share'
import { loadJobSharePanel, recordJobImageShare, shareJobToFeed, type JobSharePanelState } from '../share-actions'
import { shareCaption } from '../share-caption'
import {
  SHARE_BADGE_KEYS,
  SHARE_FACTS,
  SHARE_LABEL_KEYS,
  SHARE_LABELS,
  SHARE_LOOK_KEYS,
  SHARE_SIZE_KEYS,
  SHARE_SIZES,
  serializeShareOpts,
  shareImagePath,
  type ShareOptions,
} from '../share-options'
import { SHARE_BADGES, SHARE_THEMES } from '../share-themes'

/**
 * Round I (I1): the job share panel. "Download image" makes the PNG (download, copy, phone share, caption);
 * "Post to feed" posts the same image and caption as the job's poster. Everything comes from the job: nothing is
 * retyped. The server checks who may share on every request; this panel is only opened for them.
 */
type Tab = 'image' | 'feed'
type FitState = { fits: boolean; truncated: boolean } | null

const SIZE_HINTS: Record<keyof typeof SHARE_SIZES, string> = {
  square: 'Instagram, WhatsApp',
  portrait: 'Instagram, Facebook',
  story: 'Stories, Status',
  linkedin: 'LinkedIn, X',
}

const choiceClass = 'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 transition hover:bg-mist-50 has-[:checked]:border-navy-950 has-[:checked]:ring-2 has-[:checked]:ring-navy-950/15 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ocean-500'

function shareDay(value: string) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value))
}

function subscribeNever() {
  return () => {}
}

/** Phones that can share a PNG file through the system share sheet (Web Share level 2). */
function canShareFiles() {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [new File([new Uint8Array(1)], 'job.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}

export function JobSharePanel({ jobId, open, onClose, initialTab = 'image' }: { jobId: string; open: boolean; onClose(): void; initialTab?: Tab }) {
  const [state, setState] = useState<JobSharePanelState | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!open || state) return
    let cancelled = false
    void loadJobSharePanel(jobId).then((result) => {
      if (cancelled) return
      if (result.ok) setState(result.state)
      else setLoadError(result.error)
    }).catch(() => {
      if (!cancelled) setLoadError('We could not open the share panel. Please try again.')
    })
    return () => {
      cancelled = true
    }
  }, [open, state, jobId])

  return (
    <BottomSheet open={open} onClose={onClose} title="Share job" className="md:!max-w-5xl">
      {state ? <SharePanelBody state={state} initialTab={initialTab} onStateChange={setState} /> : (
        <div className="px-3 py-6">
          {loadError
            ? <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900">{loadError}</p>
            : <p role="status" className="text-sm text-muted">Preparing your share image…</p>}
        </div>
      )}
    </BottomSheet>
  )
}

function SharePanelBody({ state, initialTab, onStateChange }: { state: JobSharePanelState; initialTab: Tab; onStateChange(state: JobSharePanelState): void }) {
  const [tab, setTab] = useState<Tab>(state.canPostToFeed ? initialTab : 'image')
  const [options, setOptions] = useState<ShareOptions>({ ...state.defaults, facts: state.defaults.facts.filter((fact) => state.availableFacts.includes(fact)) })
  const [editedCaption, setEditedCaption] = useState<string | null>(null)
  const [fit, setFit] = useState<FitState>(null)
  const [imageLoading, setImageLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [feedMessage, setFeedMessage] = useState<{ tone: 'ok' | 'error'; text: string; postId?: string } | null>(null)
  const [posting, startPosting] = useTransition()
  const shareFiles = useSyncExternalStore(subscribeNever, canShareFiles, () => false)
  const prefetched = useRef<{ url: string; blob: Promise<Blob> } | null>(null)
  const ids = { tabs: useId(), caption: useId(), label: useId() }

  const autoCaption = useMemo(() => shareCaption(state.captionJob, options, state.applyUrl), [state.captionJob, state.applyUrl, options])
  const caption = editedCaption ?? autoCaption
  const previewUrl = shareImagePath(state.jobId, options)
  const downloadUrl = shareImagePath(state.jobId, options, { download: '1' })
  const size = SHARE_SIZES[options.size]

  // The "fits" check for the chosen options (the server shrinks or shortens text so nothing can overflow).
  const fitKey = `${options.size}|${options.look}|${serializeShareOpts(options)}`
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      fetch(shareImagePath(state.jobId, options, { format: 'json' }), { credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { fits?: boolean; truncated?: boolean } | null) => {
          if (!cancelled) setFit(body ? { fits: body.fits === true, truncated: body.truncated === true } : null)
        })
        .catch(() => undefined)
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // fitKey covers every option.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, state.jobId])

  function update(patch: Partial<ShareOptions>) {
    setImageLoading(true)
    setMessage('')
    setOptions((current) => ({ ...current, ...patch }))
  }

  function toggleFact(fact: ShareOptions['facts'][number], on: boolean) {
    update({ facts: on ? [...options.facts, fact] : options.facts.filter((value) => value !== fact) })
  }

  function imageBlob(url = previewUrl) {
    if (prefetched.current?.url === url) return prefetched.current.blob
    const blob = fetch(url, { credentials: 'same-origin' }).then((response) => {
      if (!response.ok) throw new Error('image_failed')
      return response.blob()
    })
    prefetched.current = { url, blob }
    blob.catch(() => {
      if (prefetched.current?.blob === blob) prefetched.current = null
    })
    return blob
  }

  function recordShare() {
    void recordJobImageShare(state.jobId).catch(() => undefined)
  }

  async function copyImage() {
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('unsupported')
      // Safari needs the ClipboardItem made right away, with the image still loading.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob() })])
      setMessage('Image copied. Paste it into your post.')
      recordShare()
    } catch {
      // Fallback: the browser cannot put images on the clipboard, so download it instead.
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `sea-n-shore-job-${options.size}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setMessage('This browser cannot copy images, so the image was downloaded instead.')
      recordShare()
    }
  }

  async function shareImage() {
    try {
      const file = new File([await imageBlob()], `sea-n-shore-job-${options.size}.png`, { type: 'image/png' })
      await navigator.share({ files: [file], text: caption, title: state.title })
      setMessage('Shared.')
      recordShare()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setMessage('Sharing did not work here. Download the image instead.')
    }
  }

  async function copyCaption() {
    setMessage((await copyText(caption)) ? 'Caption copied.' : 'Could not copy the caption. Select it and copy it instead.')
  }

  // Phones: fetch the image ahead of a tap on Share, so the share sheet opens while the tap still counts.
  useEffect(() => {
    if (shareFiles && !imageLoading) void imageBlob().catch(() => undefined)
    // imageBlob is stable for a preview URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareFiles, imageLoading, previewUrl])

  function postToFeed() {
    setFeedMessage(null)
    startPosting(async () => {
      const result = await shareJobToFeed({ jobId: state.jobId, size: options.size, look: options.look, opts: serializeShareOpts(options), caption })
      if (result.ok) {
        const now = new Date()
        onStateChange({
          ...state,
          lastFeedShareAt: now.toISOString(),
          nextFeedShareAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
          counts: { ...state.counts, feedPosts: state.counts.feedPosts + 1 },
        })
        setFeedMessage({ tone: 'ok', text: 'Posted to the feed.', postId: result.postId })
        return
      }
      if (result.nextAt) onStateChange({ ...state, nextFeedShareAt: result.nextAt })
      setFeedMessage({ tone: 'error', text: result.error })
    })
  }

  const tabButton = (value: Tab, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      id={`${ids.tabs}-${value}`}
      aria-selected={tab === value}
      aria-controls={`${ids.tabs}-${value}-panel`}
      tabIndex={tab === value ? 0 : -1}
      onClick={() => setTab(value)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          const next: Tab = value === 'image' ? 'feed' : 'image'
          setTab(next)
          document.getElementById(`${ids.tabs}-${next}`)?.focus()
        }
      }}
      className={`inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 md:flex-none ${tab === value ? 'bg-navy-950 text-white' : 'text-navy-950 hover:bg-mist-50'}`}
    >
      {icon}{label}
    </button>
  )

  const preview = (
    <figure className="min-w-0">
      <div className="relative mx-auto w-full overflow-hidden rounded-2xl border border-mist-100 bg-mist-50" style={{ aspectRatio: `${size.width} / ${size.height}`, maxWidth: options.size === 'story' ? 300 : options.size === 'linkedin' ? 560 : 420 }}>
        {/* The live preview is the real PNG from the server, so what you see is what you download. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={previewUrl}
          src={previewUrl}
          alt={`Preview of the ${size.label} share image`}
          width={size.width}
          height={size.height}
          onLoad={() => setImageLoading(false)}
          onError={() => setImageLoading(false)}
          className="block size-full object-contain"
          data-testid="job-share-preview"
        />
        {imageLoading ? <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-mist-100/70" /> : null}
      </div>
      <figcaption className="mt-2 flex items-center justify-center gap-1.5 text-xs font-semibold" aria-live="polite" data-testid="job-share-fit">
        {fit === null ? <span className="text-muted">Checking the layout…</span> : fit.fits ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-800"><CheckCircle2 aria-hidden="true" className="size-4" />{fit.truncated ? 'Fits: the long title was shortened' : 'Fits: all text is inside the image'}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-amber-900"><TriangleAlert aria-hidden="true" className="size-4" />Some details were left out to fit</span>
        )}
      </figcaption>
    </figure>
  )

  const captionField = (where: Tab) => (
    <div>
      <label htmlFor={`${ids.caption}-${where}`} className="text-sm font-bold text-navy-950">Caption</label>
      <textarea
        id={`${ids.caption}-${where}`}
        value={caption}
        onChange={(event) => setEditedCaption(event.target.value)}
        rows={7}
        maxLength={3000}
        className="mt-1.5 block w-full rounded-xl border border-mist-200 px-3 py-2 text-sm leading-6 text-ink focus:border-ocean-500 focus:outline-none focus:ring-2 focus:ring-ocean-500/30"
      />
      {editedCaption !== null ? <button type="button" onClick={() => setEditedCaption(null)} className="mt-1 cursor-pointer text-xs font-semibold text-ocean-700 hover:underline">Reset caption</button> : null}
    </div>
  )

  return (
    <div className="px-3 pb-2">
      <div role="tablist" aria-label="Share job" className="flex gap-1 rounded-2xl bg-mist-50 p-1">
        {tabButton('image', 'Download image', <Images aria-hidden="true" className="size-4" />)}
        {tabButton('feed', 'Post to feed', <Send aria-hidden="true" className="size-4" />)}
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {preview}

        <div className="min-w-0 space-y-5">
          <div id={`${ids.tabs}-image-panel`} role="tabpanel" aria-labelledby={`${ids.tabs}-image`} hidden={tab !== 'image'} className="space-y-5">
            <fieldset>
              <legend className="text-sm font-bold text-navy-950">Size</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {SHARE_SIZE_KEYS.map((key) => (
                  <label key={key} className={`${choiceClass} flex-col !items-start justify-center py-2`}>
                    <input type="radio" name="share-size" value={key} checked={options.size === key} onChange={() => update({ size: key })} className="sr-only" />
                    <span>{SHARE_SIZES[key].label.split(' ')[0]} <span className="font-medium text-muted">{SHARE_SIZES[key].width}×{SHARE_SIZES[key].height}</span></span>
                    <span className="text-xs font-medium text-muted">{SIZE_HINTS[key]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-bold text-navy-950">Look</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {SHARE_LOOK_KEYS.map((key) => {
                  const theme = SHARE_THEMES[key]
                  return (
                    <label key={key} className={choiceClass}>
                      <input type="radio" name="share-look" value={key} checked={options.look === key} onChange={() => update({ look: key })} className="sr-only" />
                      <span aria-hidden="true" className="size-5 rounded-full border border-mist-200" style={{ background: `linear-gradient(135deg, ${theme.background[0]}, ${theme.background[1]})` }} />
                      {theme.name}
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={ids.label} className="text-sm font-bold text-navy-950">Badge</label>
                <select
                  id={ids.label}
                  value={options.label}
                  onChange={(event) => update({ label: event.target.value as ShareOptions['label'] })}
                  className="mt-1.5 block min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 focus:border-ocean-500 focus:outline-none focus:ring-2 focus:ring-ocean-500/30"
                >
                  {SHARE_LABEL_KEYS.map((key) => <option key={key} value={key}>{SHARE_LABELS[key]}</option>)}
                </select>
              </div>
              <fieldset>
                <legend className="text-sm font-bold text-navy-950">Badge colour</legend>
                <div className="mt-1.5 flex gap-2">
                  {SHARE_BADGE_KEYS.map((key) => (
                    <label key={key} className={`${choiceClass} !px-2.5`} title={SHARE_BADGES[key].name}>
                      <input type="radio" name="share-badge" value={key} checked={options.badge === key} onChange={() => update({ badge: key })} className="sr-only" aria-label={SHARE_BADGES[key].name} />
                      <span aria-hidden="true" className="size-5 rounded-full" style={{ background: SHARE_BADGES[key].background }} />
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <fieldset>
              <legend className="text-sm font-bold text-navy-950">Show on the image</legend>
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                {state.hasSalary ? <Toggle label="Salary" checked={options.salary} onChange={(on) => update({ salary: on })} /> : null}
                <Toggle label="QR code to the job" checked={options.qr} onChange={(on) => update({ qr: on })} />
                {state.availableFacts.map((fact) => (
                  <Toggle key={fact} label={SHARE_FACTS[fact]} checked={options.facts.includes(fact)} onChange={(on) => toggleFact(fact, on)} />
                ))}
              </div>
              {!state.hasSalary || state.availableFacts.length < 4 ? <p className="mt-1 text-xs text-muted">Details the job does not have are never shown.</p> : null}
            </fieldset>

            {captionField('image')}

            <div className="flex flex-wrap gap-2">
              <a href={downloadUrl} download={`sea-n-shore-job-${options.size}.png`} onClick={recordShare} className={primaryButtonClass}><Download aria-hidden="true" className="size-4" />Download PNG</a>
              <button type="button" onClick={copyImage} className={secondaryButtonClass}><ClipboardCopy aria-hidden="true" className="size-4" />Copy image</button>
              {shareFiles ? <button type="button" onClick={shareImage} className={secondaryButtonClass}><Share2 aria-hidden="true" className="size-4" />Share</button> : null}
              <button type="button" onClick={copyCaption} className={secondaryButtonClass}><ClipboardCopy aria-hidden="true" className="size-4" />Copy caption</button>
            </div>
            <p role="status" className="min-h-5 text-sm font-semibold text-navy-900">{message}</p>
          </div>

          <div id={`${ids.tabs}-feed-panel`} role="tabpanel" aria-labelledby={`${ids.tabs}-feed`} hidden={tab !== 'feed'} className="space-y-4">
            {state.canPostToFeed ? (
              <>
                <dl className="grid gap-2 rounded-2xl bg-mist-50 p-4 text-sm">
                  <div className="flex gap-2"><dt className="font-semibold text-muted">Posting as</dt><dd className="font-bold text-navy-950">{state.postAs === 'you' ? 'You' : state.postAs}</dd></div>
                  <div className="flex gap-2"><dt className="font-semibold text-muted">Audience</dt><dd className="font-bold text-navy-950">Anyone</dd></div>
                  <div className="flex gap-2"><dt className="font-semibold text-muted">Shows as</dt><dd className="font-bold text-navy-950">Job post with the image above and an Apply button</dd></div>
                </dl>
                {captionField('feed')}
                {state.lastFeedShareAt ? (
                  <p className="text-sm text-navy-900" data-testid="job-share-feed-status">
                    Shared to feed on {shareDay(state.lastFeedShareAt)}.
                    {state.nextFeedShareAt ? ` You can share it again on ${shareDay(state.nextFeedShareAt)}.` : ''}
                  </p>
                ) : <p className="text-sm text-muted">A job can be shared to the feed once every 7 days.</p>}
                <button type="button" onClick={postToFeed} disabled={posting || Boolean(state.nextFeedShareAt)} className={primaryButtonClass}>
                  <Send aria-hidden="true" className="size-4" />{posting ? 'Posting…' : 'Post to feed'}
                </button>
                <div role="status" className="min-h-5 text-sm font-semibold">
                  {feedMessage ? (
                    <span className={feedMessage.tone === 'ok' ? 'text-emerald-800' : 'text-amber-900'}>
                      {feedMessage.text}{feedMessage.postId ? <> <Link href={postPath(feedMessage.postId)} className="underline">View post</Link></> : null}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="rounded-2xl bg-mist-50 p-4 text-sm leading-6 text-navy-900">Only the person who posted this job can share it to the feed. You can still download the image.</p>
            )}
          </div>

          <p className="border-t border-mist-100 pt-3 text-xs leading-5 text-muted" data-testid="job-share-counts">
            {state.counts.images} image share{state.counts.images === 1 ? '' : 's'} · {state.counts.feedPosts} feed post{state.counts.feedPosts === 1 ? '' : 's'} · Applies from shares: {state.counts.appliesFromImage} from the image, {state.counts.appliesFromFeed} from the feed
          </p>
        </div>
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(on: boolean): void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm font-semibold text-navy-950 hover:bg-mist-50">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-navy-950" />
      {label}
    </label>
  )
}
