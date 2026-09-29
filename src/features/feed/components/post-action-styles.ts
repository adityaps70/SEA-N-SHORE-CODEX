/**
 * Shared look of the post action row buttons (Like · Comment · Repost · Send): bordered pills
 * with a hover state. The row is a container (`@container`), so on md and wider labels show
 * only when the row is at least 34rem wide (the desktop feed column).
 *
 * Phones (below md): four equal borderless 52px columns with the icon over a 12px label; the
 * counts move to the line above the row.
 */
export const POST_ACTION_PHONE_CLASS = 'max-md:min-h-13 max-md:w-full max-md:flex-col max-md:gap-0.5 max-md:rounded-lg max-md:border-0 max-md:px-1 max-md:text-xs max-md:hover:bg-mist-50'

export const POST_ACTION_BUTTON_CLASS = `inline-flex min-h-9 min-w-0 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-mist-200 bg-white px-2 text-sm font-semibold text-navy-900 transition @min-[26rem]:px-2.5 hover:border-ocean-300 hover:bg-mist-50 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${POST_ACTION_PHONE_CLASS}`

export const POST_ACTION_LABEL_CLASS = 'hidden @min-[34rem]:inline max-md:inline max-md:leading-4'
