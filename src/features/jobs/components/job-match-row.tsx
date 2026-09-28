'use client'

import { CheckCircle2, ChevronRight, Sparkles, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { BottomSheet } from '@/components/ui/mobile-sheet'
import type { JobMatchResult } from '../types'
import { SheetPortal } from './sheet-portal'

/**
 * Phone Maritime Match (round 8): one dark row "82% Maritime Match · 3 things match · 2 to check"
 * that opens the full explanation in a sheet. Desktop keeps the full match section on the page.
 */
export function JobMatchRow({ match }: { match: JobMatchResult }) {
  const [open, setOpen] = useState(false)
  const gaps = [...match.missingRequirements, ...match.warnings]
  const summary = [
    `${match.reasons.length} thing${match.reasons.length === 1 ? '' : 's'} match`,
    gaps.length ? `${gaps.length} to check` : 'no gaps',
  ].join(' · ')

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="-mx-4 flex min-h-16 w-[calc(100%+2rem)] cursor-pointer items-center gap-3 bg-navy-950 px-4 py-3 text-left text-white hover:bg-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white"
      >
        <Sparkles aria-hidden="true" className="size-6 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold">{match.score}% Maritime Match</span>
          <span className="block text-[13px] text-white/75">{summary}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
      </button>
      <SheetPortal>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={`${match.score}% Maritime Match`} desktop="hidden">
        <div className="space-y-5 px-3 pb-2 pt-1">
          <section>
            <h3 className="text-sm font-bold text-navy-950">What matches</h3>
            {match.reasons.length ? (
              <ul className="mt-2 space-y-2">
                {match.reasons.map((reason) => <li key={reason} className="flex items-start gap-2 text-[15px] leading-6 text-ink"><CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-ocean-700" />{reason}</li>)}
              </ul>
            ) : <p className="mt-2 text-sm text-muted">Add more Maritime Passport details to improve match explanations.</p>}
          </section>
          <section>
            <h3 className="text-sm font-bold text-navy-950">Check before applying</h3>
            {gaps.length ? (
              <ul className="mt-2 space-y-2">
                {gaps.map((gap) => <li key={gap} className="flex items-start gap-2 text-[15px] leading-6 text-amber-900"><TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />{gap}</li>)}
              </ul>
            ) : <p className="mt-2 text-sm font-medium text-ocean-800">No major profile gaps detected.</p>}
          </section>
        </div>
      </BottomSheet>
      </SheetPortal>
    </div>
  )
}
