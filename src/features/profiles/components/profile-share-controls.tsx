'use client'

import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, QrCode, Share2, X } from 'lucide-react'

export function getPublicProfileUrl(slug: string, siteUrl?: string) {
  const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, '')
  const base = siteUrl?.trim().replace(/\/+$/g, '')
  if (base) return `${base}/people/${cleanSlug}`
  if (typeof window !== 'undefined') return `${window.location.origin}/people/${cleanSlug}`
  return `/people/${cleanSlug}`
}

export function ProfileShareControls({
  slug,
  siteUrl,
}: {
  slug: string
  siteUrl?: string
}) {
  const [qrOpen, setQrOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const publicUrl = useMemo(() => getPublicProfileUrl(slug, siteUrl), [siteUrl, slug])
  const secondary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-mist-100 bg-white px-3.5 text-sm font-semibold text-navy-950 transition hover:border-ocean-400 hover:text-ocean-700'

  useEffect(() => {
    if (!qrOpen) return
    let active = true
    void QRCode.toDataURL(publicUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
    }).then((dataUrl) => {
      if (active) setQrDataUrl(dataUrl)
    })
    return () => {
      active = false
    }
  }, [publicUrl, qrOpen])

  async function shareProfile() {
    if (navigator.share) {
      await navigator.share({ title: 'Sea N Shore Maritime Passport', url: publicUrl })
      return
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  async function copyProfileUrl() {
    if (!navigator.clipboard) return
    await navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <>
      <button type="button" onClick={shareProfile} className={secondary} aria-label="Share profile">
        <Share2 aria-hidden="true" className="size-4" />
        Share profile
      </button>
      <button type="button" onClick={() => setQrOpen(true)} className={secondary} aria-label="QR profile">
        <QrCode aria-hidden="true" className="size-4" />
        QR profile
      </button>

      {qrOpen ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-navy-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setQrOpen(false)
        }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-share-dialog-title"
            className="w-full max-w-md rounded-[1.75rem] border border-white/20 bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Public profile</p>
                <h2 id="profile-share-dialog-title" className="mt-1 text-xl font-semibold text-navy-950">Share Maritime Passport</h2>
                <p className="mt-1 text-sm leading-5 text-muted">Anyone scanning this code opens the same public profile recruiters see.</p>
              </div>
              <button type="button" onClick={() => setQrOpen(false)} aria-label="Close QR profile" className="grid size-9 shrink-0 place-items-center rounded-full border border-mist-100 text-muted hover:text-navy-950">
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>

            <div className="mt-5 grid place-items-center rounded-2xl border border-mist-100 bg-mist-50/50 p-4">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- generated QR is an in-memory data URL, not a remote image asset
                <img src={qrDataUrl} alt={`QR code for ${slug} Maritime Passport`} className="size-64 max-w-full rounded-xl bg-white object-contain" />
              ) : (
                <div className="grid size-64 max-w-full place-items-center rounded-xl bg-white text-sm font-medium text-muted">Generating QR code…</div>
              )}
            </div>

            <p className="mt-4 break-all rounded-xl bg-mist-50 px-3 py-2.5 text-xs leading-5 text-muted">{publicUrl}</p>
            <button type="button" onClick={copyProfileUrl} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white">
              {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
              {copied ? 'Link copied' : 'Copy profile link'}
            </button>
          </section>
        </div>
      ) : null}
    </>
  )
}
