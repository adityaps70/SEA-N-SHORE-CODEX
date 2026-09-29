'use client'

import Link from 'next/link'
import {
  BriefcaseBusiness,
  CalendarPlus,
  FileText,
  GraduationCap,
  Image as ImageIcon,
  LayoutGrid,
  SquarePen,
  type LucideIcon,
} from 'lucide-react'
import { BottomSheet } from '@/components/ui/mobile-sheet'

export type CreateSheetItem = { href: string; label: string; hint?: string; icon: LucideIcon }

/**
 * What the phone Post tab can create. The first three open the Home composer
 * (`/home?compose=…`), where "Post as" is chosen; the rest are the same entries as the
 * desktop Create menu.
 */
export const CREATE_SHEET_GROUPS: CreateSheetItem[][] = [
  [
    { href: '/home?compose=update', label: 'Write a post', hint: 'Update · Question · Poll', icon: SquarePen },
    { href: '/home?compose=photo', label: 'Photo or video', icon: ImageIcon },
    { href: '/home?compose=document', label: 'Document (PDF)', icon: FileText },
  ],
  [
    { href: '/hiring/jobs/new', label: 'Post a job', icon: BriefcaseBusiness },
    { href: '/events/create', label: 'Create an event', icon: CalendarPlus },
    { href: '/learn/studio/courses/new', label: 'Create a course', icon: GraduationCap },
    { href: '/creator', label: 'All creator tools', icon: LayoutGrid },
  ],
]

/** The phone Create sheet, opened from the Post tab. Phones only (`desktop="hidden"`). */
export function CreateSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Create" desktop="hidden">
      {CREATE_SHEET_GROUPS.map((group, index) => (
        <ul key={index} className={index > 0 ? 'mt-1 pt-1 before:mx-4 before:mb-1 before:block before:border-t before:border-mist-100 before:content-[""]' : 'mt-1'}>
          {group.map(({ href, label, hint, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                onClick={onClose}
                className="flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
              >
                <Icon aria-hidden="true" className="size-6 shrink-0 text-navy-900" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">{label}</span>
                {hint ? <span className="shrink-0 text-xs font-medium text-muted">{hint}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ))}
    </BottomSheet>
  )
}
