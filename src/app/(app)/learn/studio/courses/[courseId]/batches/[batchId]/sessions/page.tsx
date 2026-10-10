import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CalendarClock, CalendarPlus } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { BatchError, batchRepository } from '@/features/learning/batches/batch-repository'
import { BatchTabs } from '@/features/learning/batches/components/batch-tabs'
import { SessionCreatePanel, SessionStudioList, type StudioSession } from '@/features/learning/sessions/components/session-studio'
import { sessionRepository } from '@/features/learning/sessions/session-repository'

export const metadata: Metadata = { title: 'Batch sessions' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Round D (D2): a batch's live sessions for its manager, instructors and the course's trainers: add one-off and
 * recurring sessions, edit or cancel them, take attendance and attach recordings.
 */
export default async function BatchSessionsPage({ params }: { params: Promise<{ courseId: string; batchId: string }> }) {
  const { courseId, batchId } = await params
  if (!UUID.test(courseId) || !UUID.test(batchId)) notFound()
  const user = await requireAwsUser()
  const actor = { actorId: user.id, allCourses: await canUsePlatformAdminAuthority(user.id) }
  const staff = await batchRepository.getForStaff(actor, batchId).catch((error: unknown) => {
    if (error instanceof BatchError && error.code === 'batch_not_found') return null
    throw error
  })
  if (!staff || staff.course.id !== courseId) notFound()
  const { sessions } = await sessionRepository.listForStaff(actor, batchId)
  const now = new Date()
  const withAttendance: StudioSession[] = await Promise.all(sessions.map(async (session) => (
    session.status === 'scheduled' && Date.parse(session.startsAt) <= now.getTime()
      ? { ...session, attendees: (await sessionRepository.attendees(actor, session.id)).attendees }
      : session
  )))
  const ids = { courseId, batchId }
  const zone = staff.batch.timeZone

  return (
    <div className="mx-auto w-full max-w-5xl py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref={`/learn/studio/courses/${courseId}/batches/${batchId}`} title="Sessions" />
      <Link href={`/learn/studio/courses/${courseId}/batches/${batchId}`} className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline max-md:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to the batch
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] max-md:mt-3 sm:p-8">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200"><CalendarClock aria-hidden="true" className="size-4" /> {staff.course.title}</p>
        <h1 className="mt-2 break-words text-3xl font-bold tracking-tight">{staff.batch.title}: sessions</h1>
        <p className="mt-3 text-sm text-white/70">Times on this page are in the batch&rsquo;s time zone, {zone}. Learners see them in their own.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={`/api/learn/batches/${batchId}/calendar`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50">
            <CalendarPlus aria-hidden="true" className="size-4" /> Calendar file of all sessions
          </a>
        </div>
      </section>

      <BatchTabs courseId={courseId} batchId={batchId} active="sessions" />

      <div className="mt-5 grid gap-5">
        <SessionCreatePanel ids={ids} defaultZone={zone} />
        <SessionStudioList ids={ids} sessions={withAttendance} zone={zone} now={now.toISOString()} />
      </div>
    </div>
  )
}
