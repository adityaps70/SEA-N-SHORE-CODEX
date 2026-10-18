import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'

/** Round H (H7): shared field and button styles for the support forms (plain strings, safe on server and client). */
export const supportInputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-mist-200 bg-white px-3.5 text-base text-ink placeholder:text-muted focus:border-ocean-600 focus:outline-none focus:ring-2 focus:ring-ocean-200 aria-[invalid=true]:border-red-500'

export const supportPrimaryButtonClass = cn(buttonClass({ variant: 'primary', size: 'sm' }), 'min-h-11 px-5 disabled:cursor-wait')

export const supportSecondaryButtonClass = cn(buttonClass({ variant: 'secondary', size: 'sm' }), 'min-h-11 disabled:cursor-wait')
