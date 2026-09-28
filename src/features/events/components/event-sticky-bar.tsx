import Link from 'next/link'
import { CalendarPlus, CheckCircle2, Settings2, Video } from 'lucide-react'
import { AttendanceControl } from './attendance-control'
import { EventBarCheckout } from './event-bar-checkout'

export type EventStickyAction = 'manage' | 'join' | 'attending' | 'register' | 'pay' | 'unavailable'

/**
 * Which main action the phone sticky bar shows (round 8):
 * hosts manage the event; registered people join the online session once its link is
 * available, otherwise see that they are attending; everyone else registers (free) or pays
 * (paid) — or sees why they cannot (full, closed, ended, cancelled; ended and cancelled
 * events show that to attendees too).
 */
export function eventStickyAction(input: {
  viewerIsHost: boolean
  viewerIsAttending: boolean
  canJoinOnline: boolean
  isPaid: boolean
  canRegister: boolean
  ended?: boolean
  cancelled?: boolean
}): EventStickyAction {
  // A cancelled event can no longer be edited (the edit page sends hosts back to it).
  if (input.viewerIsHost) return input.cancelled ? 'unavailable' : 'manage'
  if (input.ended || input.cancelled) return 'unavailable'
  if (input.viewerIsAttending) return input.canJoinOnline ? 'join' : 'attending'
  if (!input.canRegister) return 'unavailable'
  return input.isPaid ? 'pay' : 'register'
}

const primaryClass = 'inline-flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-ocean-700 px-5 text-[15px] font-bold text-white transition hover:bg-ocean-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'

/**
 * Phone-only sticky bottom bar on an event page: the main action as one filled pill, with an
 * outline "Add to calendar" (.ics) button beside it. Sits above the bottom tab bar.
 */
export function EventStickyBar({
  action,
  eventId,
  eventTitle,
  meetingUrl,
  priceLabel,
  paymentsConfigured,
  unavailableLabel,
  blockedMessage,
}: {
  action: EventStickyAction
  eventId: string
  eventTitle: string
  meetingUrl: string | null
  priceLabel: string
  paymentsConfigured: boolean
  /** "Event full", "Registration closed", "Event ended"… */
  unavailableLabel: string
  /** Why a paid event cannot be bought right now (currency not accepted). */
  blockedMessage?: string
}) {
  return (
    <div
      role="region"
      aria-label="Event actions"
      className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 mt-4 flex items-end gap-3 border-t border-mist-100 bg-white px-4 py-3 shadow-[0_-8px_24px_rgb(7_27_45/0.08)] md:hidden"
    >
      <a
        href={`/events/${eventId}/calendar`}
        aria-label="Add to calendar (.ics)"
        className="grid size-12 shrink-0 place-items-center rounded-full border border-ocean-700 bg-white text-ocean-700 hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
      >
        <CalendarPlus aria-hidden="true" className="size-5" />
      </a>
      {action === 'manage' ? (
        <Link href={`/events/${eventId}/edit`} className={primaryClass}>
          <Settings2 aria-hidden="true" className="size-4" /> Manage event
        </Link>
      ) : action === 'join' && meetingUrl ? (
        <a href={meetingUrl} target="_blank" rel="noreferrer" className={primaryClass}>
          <Video aria-hidden="true" className="size-4" /> Join online session
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : action === 'attending' ? (
        <p className="inline-flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-emerald-50 px-5 text-[15px] font-bold text-emerald-800">
          <CheckCircle2 aria-hidden="true" className="size-5 shrink-0" /> You&apos;re attending
        </p>
      ) : action === 'pay' ? (
        <EventBarCheckout
          eventId={eventId}
          eventTitle={eventTitle}
          priceLabel={priceLabel}
          paymentsConfigured={paymentsConfigured}
          blockedMessage={blockedMessage}
        />
      ) : (
        <AttendanceControl
          variant="bar"
          eventId={eventId}
          attending={false}
          disabled={action === 'unavailable'}
          unavailableLabel={unavailableLabel}
        />
      )}
    </div>
  )
}
