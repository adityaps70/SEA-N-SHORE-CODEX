'use client'

import { ListOrdered } from 'lucide-react'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { BottomSheet } from '@/components/ui/mobile-sheet'

/**
 * Phone course player (round 8): the curriculum lives behind a "Curriculum 3/12" button next to
 * Mark complete instead of above the lesson. Choosing a lesson closes the sheet.
 */
export function CourseCurriculumSheet({
  position,
  total,
  children,
}: {
  /** 1-based position of the open lesson (0 when none is open). */
  position: number
  total: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  function closeOnLessonClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('a')) setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border border-ocean-700 bg-white px-3 text-[15px] font-semibold text-ocean-700 transition hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 md:hidden"
      >
        <ListOrdered aria-hidden="true" className="size-5" />
        Curriculum {position}/{total}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Course curriculum" desktop="hidden">
        <div onClick={closeOnLessonClick} className="px-2 pb-2">{children}</div>
      </BottomSheet>
    </>
  )
}
