/**
 * Phone chip styles for the jobs and hiring screens (round 8): 32px pills, selected = navy-950
 * filled. The ::before pseudo-element grows the tap area to 44px without changing the look.
 */
const CHIP_BASE =
  "relative inline-flex min-h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-50"

export function chipClass(selected: boolean) {
  return `${CHIP_BASE} ${selected ? 'border-navy-950 bg-navy-950 text-white' : 'border-mist-300 bg-white text-navy-900 hover:bg-mist-50'}`
}

/** One horizontally scrolling chip row that bleeds to the screen edges on phones. */
export const CHIP_ROW_CLASS = '-mx-4 flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

/** Filled and outline pill buttons for phone bars and sheets. */
export const PHONE_PRIMARY_BUTTON =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-ocean-700 px-5 text-[15px] font-semibold text-white transition hover:bg-ocean-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-wait disabled:opacity-60'
export const PHONE_OUTLINE_BUTTON =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-ocean-700 bg-white px-5 text-[15px] font-semibold text-ocean-700 transition hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60'

/** Round "…" icon button that opens a phone bottom sheet. */
export const MORE_BUTTON_CLASS =
  'grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-navy-900 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'
