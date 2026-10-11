'use client'

import { ListOrdered } from 'lucide-react'
import { useState } from 'react'
import { BottomSheet } from '@/components/ui/mobile-sheet'
import { CurriculumAccordion, type CurriculumModuleView } from './curriculum-accordion'

/**
 * Phones and small tablets (round 8, round E): the curriculum lives behind a "Curriculum 3/12" button in the
 * lesson's bottom bar. It opens the same accordion as the desktop sidebar in a sheet (a dialog on tablets),
 * which traps focus while open and closes after a lesson is chosen.
 */
export function CourseCurriculumSheet({
  position,
  total,
  modules,
  currentItemId,
  storageKey,
}: {
  /** 1-based position of the open lesson (0 when none is open). */
  position: number
  total: number
  modules: CurriculumModuleView[]
  currentItemId: string | null
  storageKey: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border border-ocean-700 bg-white px-4 text-[15px] font-semibold text-ocean-700 transition hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600 lg:hidden"
      >
        <ListOrdered aria-hidden="true" className="size-5" />
        Curriculum {position}/{total}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Course curriculum">
        <div className="px-2 pb-2">
          <CurriculumAccordion
            modules={modules}
            currentItemId={currentItemId}
            storageKey={storageKey}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </BottomSheet>
    </>
  )
}
