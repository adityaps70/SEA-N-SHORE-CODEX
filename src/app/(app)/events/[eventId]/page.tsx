import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { BadgeCheck, CalendarDays, CalendarPlus, Download, MapPin, Monitor, ReceiptText, Ticket, Users } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { PlanHiddenBanner } from '@/features/billing/components/plan-hidden-banner'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { AttendanceControl } from '@/features/events/components/attendance-control'
import { EventAboutText } from '@/features/events/components/event-about-text'
import { EventActionsMenu } from '@/features/events/components/event-actions-menu'
import { EventStickyBar, eventStickyAction } from '@/features/events/components/event-sticky-bar'
import { EventNav } from '@/features/events/components/event-nav'
import { EventShareButton } from '@/features/events/components/event-share-button'
import { eventDetailDateLine } from '@/features/events/event-dates'
import { eventFormatLabel, eventPlaceShort, eventPriceLabel, eventPublisherHref } from '@/features/events/event-labels'
import { EventCheckoutButton } from '@/features/payments/components/event-checkout-button'
import { CURRENCY_UNAVAILABLE_BUYER_MESSAGE } from '@/features/payments/event-payment-rules'
import { getPaymentCapabilities } from '@/features/payments/provider'
import { isPaymentCurrency } from '@/features/payments/currency'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'

function dateTime(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(value))
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(value))
  }
}

function dateRange(start: string, end: string, timeZone: string) {
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'short' }
  for (const zone of [timeZone, undefined]) {
    try {
      return new Intl.DateTimeFormat('en', { ...options, timeZone: zone }).formatRange(new Date(start), new Date(end))
    } catch {
      // Unknown timezone or no formatRange support: try the next option.
    }
  }
  return `${dateTime(start, timeZone)} – ${dateTime(end, timeZone)}`
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function calendarStamp(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function googleCalendarUrl(input: { title: string; summary: string; startAt: string; endAt: string; location: string }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${calendarStamp(input.startAt)}/${calendarStamp(input.endAt)}`,
    details: input.summary,
    location: input.location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

const loadEvent = cache((eventId: string, userId: string) => calendarEventRepository.getEvent(eventId, userId))

export async function generateMetadata({ params }: { params: Promise<{ eventId: string }> }): Promise<Metadata> {
  const user = await requireAwsUser()
  const { eventId } = await params
  const event = await loadEvent(eventId, user.id)
  return { title: event ? event.title : 'Event not found' }
}

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireAwsUser()
  const { eventId } = await params
  const event = await loadEvent(eventId, user.id)
  if (!event) notFound()

  const place = [event.locationName, event.locationAddress, event.city, event.country].filter(Boolean).join(', ')
  const seatsLeft = event.capacity === null ? null : Math.max(event.capacity - event.attendeeCount, 0)
  const registrationState = event.isPast
    ? 'ended'
    : event.status !== 'published'
      ? 'closed'
      : seatsLeft === 0 && !event.viewerIsAttending
        ? 'full'
        : event.registrationOpen || event.viewerIsAttending
          ? 'open'
          : 'closed'
  const registrationLabel = registrationState === 'ended'
    ? 'Event ended'
    : registrationState === 'full'
      ? 'Event full'
      : registrationState === 'closed'
        ? 'Registration closed'
        : 'Registration open'
  const calendarHref = googleCalendarUrl({
    title: event.title,
    summary: event.summary,
    startAt: event.startAt,
    endAt: event.endAt,
    location: event.format === 'online' ? 'Online' : place || 'Venue to be confirmed',
  })
  const canJoinOnline = Boolean(event.meetingUrl && !event.isPast && event.status === 'published')
  const showAttendanceControl = !event.viewerIsHost && !event.isPast && event.status !== 'cancelled'
  const isPaidEvent = event.pricing === 'paid'
  const priceLabel = eventPriceLabel(event)
  const payments = isPaidEvent ? await getPaymentCapabilities() : null
  const paymentsConfigured = payments ? payments.configured : true
  // Tickets can be bought only when a gateway is set up and it accepts the event's currency.
  const currencyUnavailable = Boolean(payments?.configured && isPaymentCurrency(event.currency) && !payments.currencies.includes(event.currency))
  const publisherHref = eventPublisherHref(event)
  const stickyAction = eventStickyAction({
    viewerIsHost: event.viewerIsHost,
    viewerIsAttending: event.viewerIsAttending,
    canJoinOnline,
    isPaid: isPaidEvent,
    canRegister: showAttendanceControl && registrationState === 'open',
    ended: event.isPast,
    cancelled: event.status === 'cancelled',
  })
  // Phones: About joins the summary and the description under one heading.
  const aboutText = [event.summary, event.description].filter(Boolean).join('\n\n')
  const phoneSectionClass = 'max-md:-mx-4 max-md:mt-4 max-md:border-t-8 max-md:border-mist-100 max-md:px-4 max-md:pt-4'

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 py-2 sm:px-6 sm:py-6 max-md:space-y-0 max-md:py-0">
      <MobilePageBar
        backHref="/events"
        className="max-md:mb-0"
        right={(
          <EventActionsMenu
            eventId={event.id}
            title={event.title}
            googleCalendarHref={calendarHref}
            canWithdraw={event.viewerIsAttending && !event.viewerHasPaid && !isPaidEvent && showAttendanceControl}
            canReport={!event.viewerIsHost}
            paidRegistrationsHref={event.viewerIsHost && isPaidEvent ? `/events/${event.id}/registrations` : null}
          />
        )}
      />
      <EventNav active="discover" className="max-md:hidden" />
      <article className="overflow-hidden rounded-[2rem] border border-mist-100 bg-white shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-0 max-md:shadow-none">
        {event.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- only organizer supplied public/signed display URLs are stored
          <img src={event.bannerUrl} alt="" className="max-h-80 w-full object-cover max-md:aspect-[16/9] max-md:max-h-56" />
        ) : <div className="h-36 bg-gradient-to-br from-navy-950 via-navy-800 to-teal-700 max-md:h-28" />}
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_300px] max-md:gap-4 max-md:p-4">
          <div className="max-md:flex max-md:flex-col">
            <p className="text-[13px] font-bold uppercase tracking-wide text-amber-700 md:hidden">{eventDetailDateLine(event.startAt, event.endAt, event.timezone)}</p>
            {/* Phones: the chips and the facts grid below are replaced by the date line, host and two info chips. */}
            <div className="flex flex-wrap gap-2 max-md:hidden">
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-800">{eventFormatLabel(event.format)}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${isPaidEvent ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>{isPaidEvent ? `Paid · ${priceLabel}` : 'Free'}</span>
              <span className="rounded-full bg-navy-50 px-3 py-1 text-xs font-bold text-navy-700">{titleCase(event.category)}</span>
              <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-bold text-navy-700">{titleCase(event.eventType)}</span>
              <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-bold capitalize text-navy-700">{event.status}</span>
            </div>

            <h1 className="mt-4 text-3xl font-bold tracking-tight text-navy-950 sm:text-4xl max-md:mt-1.5 max-md:text-[22px] max-md:leading-7">{event.title}</h1>
            <p className="mt-1 text-[15px] text-ink md:hidden">
              Hosted by{' '}
              {publisherHref ? (
                <Link href={publisherHref} className="font-bold text-ocean-700 hover:underline">{event.publisherName}</Link>
              ) : (
                <span className="font-bold text-navy-950">{event.publisherName}</span>
              )}
              {event.publisherType === 'organization' && event.publisherVerified ? <BadgeCheck aria-label="Verified organization" className="ml-1 inline size-4 align-[-2px] text-ocean-700" /> : null}
            </p>
            <ul className="mt-3 flex flex-wrap gap-2 md:hidden" aria-label="Event details">
              <li className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-mist-100 px-3 text-[13px] font-semibold text-navy-800">
                {event.format === 'online' ? <Monitor aria-hidden="true" className="size-4" /> : <MapPin aria-hidden="true" className="size-4" />}
                {eventPlaceShort(event)}
              </li>
              <li className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-mist-100 px-3 text-[13px] font-semibold text-navy-800">
                <Users aria-hidden="true" className="size-4" />
                {event.attendeeCount}{event.capacity ? ` / ${event.capacity}` : ''} attending
              </li>
            </ul>
            <p className="mt-3 text-lg leading-8 text-navy-700 max-md:hidden">{event.summary}</p>

            <section aria-labelledby="event-about-phone" className={`md:hidden ${phoneSectionClass}`}>
              <h2 id="event-about-phone" className="mb-2 text-[17px] font-bold text-navy-950">About</h2>
              <EventAboutText text={aboutText} />
            </section>

            <div className="mt-6 grid gap-3 rounded-2xl bg-mist-50 p-5 text-sm text-navy-800 sm:grid-cols-2 max-md:hidden">
              <span className="flex gap-2"><CalendarDays className="h-4 w-4 shrink-0 text-teal-700" />{dateRange(event.startAt, event.endAt, event.timezone)}</span>
              <span className="flex gap-2">{event.format === 'online' ? <Monitor className="h-4 w-4 shrink-0 text-teal-700" /> : <MapPin className="h-4 w-4 shrink-0 text-teal-700" />}{event.format === 'online' ? 'Online' : `${place || 'Venue to be confirmed'}${event.format === 'hybrid' ? ' · also online' : ''}`}</span>
              <span className="flex gap-2"><Users className="h-4 w-4 text-teal-700" />{event.attendeeCount}{event.capacity ? ` / ${event.capacity}` : ''} attending</span>
              <span>Timezone: {event.timezone}</span>
              <span className="flex gap-2"><Ticket className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />{isPaidEvent ? `Ticket: ${priceLabel}` : 'Free to attend'}</span>
            </div>

            {event.description ? <div className="mt-8 whitespace-pre-wrap text-sm leading-7 text-navy-800 max-md:hidden">{event.description}</div> : null}

            {event.agenda.length ? (
              <section className={`mt-8 max-md:order-3 ${phoneSectionClass}`}>
                <h2 className="text-lg font-bold text-navy-950 max-md:text-[17px]">Agenda</h2>
                <ol className="mt-3 space-y-2">
                  {event.agenda.map((item, index) => (
                    <li key={`${index}-${item}`} className="flex gap-3 rounded-xl bg-mist-50 px-4 py-3 text-sm text-navy-800">
                      <span className="font-bold text-teal-700">{String(index + 1).padStart(2, '0')}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {event.speakerDetails.length ? (
              <section className={`mt-8 max-md:order-2 ${phoneSectionClass}`}>
                <h2 className="text-lg font-bold text-navy-950 max-md:text-[17px]">Speakers</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 max-md:gap-4">
                  {event.speakerDetails.map((speaker) => (
                    <div key={`${speaker.name}-${speaker.organization}`} className="rounded-xl border border-mist-100 p-4 max-md:flex max-md:items-center max-md:gap-3 max-md:border-0 max-md:p-0">
                      <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-ocean-50 text-[15px] font-bold text-ocean-800 md:hidden">
                        {speaker.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}
                      </span>
                      <div className="min-w-0">
                        <p className="font-bold text-navy-950 max-md:text-[15px] max-md:font-semibold">{speaker.name}</p>
                        {speaker.title ? <p className="mt-1 text-sm text-navy-700 max-md:mt-0 max-md:text-[13px]">{speaker.title}</p> : null}
                        {speaker.organization ? <p className="text-xs text-muted max-md:text-[13px]">{speaker.organization}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : event.speakers.length ? (
              <section className={`mt-8 max-md:order-2 ${phoneSectionClass}`}>
                <h2 className="font-bold text-navy-950 max-md:text-[17px]">Speakers</h2>
                <p className="mt-2 text-sm text-navy-700">{event.speakers.join(' · ')}</p>
              </section>
            ) : null}

            {event.topics.length ? (
              <section className={`mt-8 max-md:order-4 ${phoneSectionClass}`}>
                <h2 className="font-bold text-navy-950 max-md:text-[17px]">What you&apos;ll learn</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {event.topics.map((topic) => <span key={topic} className="rounded-lg bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800">{topic}</span>)}
                </div>
              </section>
            ) : null}
          </div>

          {/* Phones: the main action moves to the sticky bar and the secondary ones to the "…" sheet;
              registration details, host notices and attendance status stay here. */}
          <aside className="space-y-4 rounded-2xl border border-mist-100 bg-white p-5 shadow-sm lg:sticky lg:top-24 lg:self-start max-md:-mx-4 max-md:space-y-3 max-md:rounded-none max-md:border-0 max-md:border-t-8 max-md:border-mist-100 max-md:px-4 max-md:pb-0 max-md:pt-4 max-md:shadow-none">
            <div className="max-md:hidden">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted">Hosted by</p>
              {event.publisherType === 'personal' && publisherHref ? (
                <Link href={publisherHref} className="mt-1 block font-bold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline">
                  {event.publisherName}
                </Link>
              ) : (
                <p className="mt-1 font-bold text-navy-950">{event.publisherName}</p>
              )}
              {event.publisherType === 'organization' && event.publisherVerified ? (
                <p className="mt-1 text-xs font-semibold text-emerald-700">Verified organization</p>
              ) : null}
            </div>

            <div className="rounded-xl bg-mist-50 p-3 text-xs leading-5 text-navy-700" aria-live="polite">
              <p className="font-bold text-navy-900">Registration</p>
              <p className={registrationState === 'open' ? 'font-semibold text-emerald-700' : 'font-semibold text-navy-800'}>{registrationLabel}</p>
              {seatsLeft !== null && !event.isPast ? <p>{seatsLeft} seats left</p> : null}
              {event.registrationClosesAt && !event.isPast ? <p>Registration closes {dateTime(event.registrationClosesAt, event.timezone)}</p> : null}
              <p className="mt-1 font-semibold text-navy-900">{isPaidEvent ? `Ticket price: ${priceLabel}` : 'Free event'}</p>
            </div>

            {event.viewerIsHost ? (
              <div className="space-y-2">
                {event.hiddenForPlan ? <PlanHiddenBanner companyId={event.companyId} /> : null}
                <Link href={`/events/${event.id}/edit`} className="block min-h-12 rounded-xl bg-navy-950 px-4 py-3 text-center text-sm font-bold text-white hover:bg-navy-800 transition-colors max-md:hidden">Manage event</Link>
                {isPaidEvent ? (
                  <Link href={`/events/${event.id}/registrations`} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50 max-md:hidden">
                    <ReceiptText className="h-4 w-4 text-teal-700" aria-hidden="true" />
                    Paid registrations
                  </Link>
                ) : null}
                {currencyUnavailable ? (
                  <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">
                    Sea N Shore can only take payments in Indian rupees (INR) right now, so attendees can&apos;t buy tickets priced in US dollars yet. Edit the event and choose INR to start selling tickets.
                  </p>
                ) : null}
                {isPaidEvent && !paymentsConfigured ? (
                  <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">
                    Payments aren&apos;t switched on for Sea N Shore yet, so attendees see &ldquo;Registration opens soon&rdquo; instead of a Pay button. Nothing else is needed from you.
                  </p>
                ) : null}
              </div>
            ) : showAttendanceControl ? (
              isPaidEvent && !event.viewerIsAttending ? (
                <div className="max-md:hidden">
                <EventCheckoutButton
                  eventId={event.id}
                  eventTitle={event.title}
                  priceLabel={priceLabel}
                  paymentsConfigured={paymentsConfigured}
                  disabled={registrationState !== 'open'}
                  unavailableLabel={registrationLabel}
                  blockedMessage={currencyUnavailable ? CURRENCY_UNAVAILABLE_BUYER_MESSAGE : undefined}
                />
                </div>
              ) : (
                <div className={event.viewerIsAttending ? '' : 'max-md:hidden'}>
                <AttendanceControl
                  eventId={event.id}
                  attending={event.viewerIsAttending}
                  disabled={registrationState !== 'open' && !event.viewerIsAttending}
                  paid={event.viewerHasPaid}
                  paidLabel={event.viewerHasPaid ? priceLabel : undefined}
                  unavailableLabel={registrationLabel}
                />
                </div>
              )
            ) : null}
            {!event.viewerIsHost && isPaidEvent && !event.viewerIsAttending && currencyUnavailable ? (
              <p className="text-xs leading-5 text-navy-700 md:hidden">{CURRENCY_UNAVAILABLE_BUYER_MESSAGE}</p>
            ) : null}

            {!event.viewerIsHost && !event.viewerIsAttending && registrationState !== 'open' ? (
              <p className="text-xs leading-5 text-muted">
                {registrationState === 'full' ? 'No seats are currently available.' : registrationState === 'ended' ? 'Registration is no longer available because this event has ended.' : 'Registration is not currently accepting attendees.'}
              </p>
            ) : null}

            <div className="space-y-2 border-t border-mist-100 pt-4 max-md:hidden">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Add to calendar</p>
              <a
                href={calendarHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50"
              >
                <CalendarPlus className="h-4 w-4 text-teal-700" aria-hidden="true" />
                Google Calendar
              </a>
              <a
                href={`/events/${event.id}/calendar`}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50"
              >
                <Download className="h-4 w-4 text-teal-700" aria-hidden="true" />
                Download .ics
              </a>
            </div>

            <div className="max-md:hidden">
              <EventShareButton title={event.title} />
            </div>

            {!event.viewerIsHost ? (
              <div className="max-md:hidden">
                <ReportContentButton targetType="event" targetId={event.id} label="Report event" />
              </div>
            ) : null}

            {canJoinOnline ? (
              <a
                href={event.meetingUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                // Phones: attendees join from the sticky bar; hosts (whose bar says Manage event) keep this link.
                className={`block min-h-12 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-center text-sm font-bold text-teal-800 hover:bg-teal-100 hover:border-teal-300 transition-colors ${event.viewerIsHost ? '' : 'max-md:hidden'}`}
              >
                Join online session
              </a>
            ) : null}
            {!event.meetingUrl && !event.isPast && (event.format === 'online' || event.format === 'hybrid') ? <p className="text-xs leading-5 text-muted">The joining link becomes visible to the host and registered attendees.</p> : null}
          </aside>
        </div>
      </article>
      <EventStickyBar
        action={stickyAction}
        eventId={event.id}
        eventTitle={event.title}
        meetingUrl={event.meetingUrl}
        priceLabel={priceLabel}
        paymentsConfigured={paymentsConfigured}
        unavailableLabel={event.status === 'cancelled' ? 'Event cancelled' : registrationLabel}
        blockedMessage={currencyUnavailable ? CURRENCY_UNAVAILABLE_BUYER_MESSAGE : undefined}
      />
    </div>
  )
}
