import Link from 'next/link'
import { ArrowRight, Award, CalendarClock, CheckCircle2, Download, ExternalLink, PlayCircle } from 'lucide-react'
import type { LearnerCertificateSummary } from '../certificate-repository'
import type { ResumeCourse } from '../learner-home-repository'
import { lessonTypeLabel } from '../lesson-type-labels'

/** A day in the learner's calendar, as on receipts ("14 Sept 2026"). */
export function formatLearningDate(value: string | Date | null) {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date)
}

function playerHref(slug: string, lessonId?: string) {
  return lessonId ? `/learn/courses/${slug}/learn?lesson=${lessonId}` : `/learn/courses/${slug}/learn`
}

/**
 * "Continue" card at the top of My Learning (learning round C, C6): the course the learner was last active in and
 * the exact lesson the player would open next.
 */
export function ResumeCourseCard({ resume }: { resume: ResumeCourse }) {
  const { point } = resume
  if (point.kind === 'empty') return null

  const heading = point.kind === 'next'
    ? `Continue: ${resume.title} · lesson ${point.position} of ${point.total}`
    : point.kind === 'all_done'
      ? `All lessons done — ${resume.title}`
      : `Up next: ${resume.title}`
  const detail = point.kind === 'next'
    ? `${point.lesson.title} · ${lessonTypeLabel(point.lesson.lessonType)}`
    : point.kind === 'all_done'
      ? `You have completed all ${point.total} lessons.`
      : point.opensAt
        ? `Next lesson opens on ${formatLearningDate(point.opensAt)}.`
        : 'Your next lesson isn’t open yet.'
  const action = point.kind === 'next'
    ? { href: playerHref(resume.slug, point.lesson.id), label: 'Resume lesson' }
    : point.kind === 'all_done'
      ? { href: playerHref(resume.slug), label: 'Review course' }
      : { href: playerHref(resume.slug), label: 'Open course' }
  const Icon = point.kind === 'next' ? PlayCircle : point.kind === 'all_done' ? CheckCircle2 : CalendarClock

  return (
    <section
      aria-labelledby="resume-course-title"
      className="mt-6 rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:mt-0 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:px-4 max-md:shadow-none sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-800">
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-meta font-semibold text-teal-800">Pick up where you left off</p>
            <h2 id="resume-course-title" className="mt-1 break-words text-lg font-bold tracking-tight text-navy-950 sm:text-xl">
              {heading}
            </h2>
            <p className="mt-1 break-words text-sm leading-6 text-muted">{detail}</p>
          </div>
        </div>
        <Link
          href={action.href}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white transition hover:bg-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 max-sm:w-full"
        >
          {action.label} <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </section>
  )
}

function validityLine(certificate: LearnerCertificateSummary) {
  if (!certificate.expiresAt) return { label: 'No expiry', tone: 'bg-mist-50 text-navy-700' }
  if (certificate.expired) return { label: 'Expired', tone: 'bg-amber-50 text-amber-900' }
  return { label: `Valid until ${formatLearningDate(certificate.expiresAt)}`, tone: 'bg-teal-50 text-teal-900' }
}

/** My Learning → Certificates: every certificate the learner holds (learning round C, C6). */
export function LearnerCertificatesList({ certificates }: { certificates: LearnerCertificateSummary[] | null }) {
  if (!certificates) {
    return (
      <p role="status" className="mt-6 rounded-[1.4rem] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        We couldn&apos;t load your certificates just now. Refresh the page to try again — your certificates are safe.
      </p>
    )
  }
  if (!certificates.length) {
    return (
      <p className="mt-6 rounded-[1.4rem] border border-dashed border-mist-200 bg-white p-6 text-sm leading-6 text-muted">
        No certificates yet. When you finish a course that gives a certificate, it appears here to download and share.
      </p>
    )
  }

  return (
    <ul aria-label="Your certificates" className="mt-6 space-y-3">
      {certificates.map((certificate) => {
        const validity = validityLine(certificate)
        return (
          <li key={certificate.certificateId} className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-800">
                  <Award aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="break-words font-bold text-navy-950">{certificate.courseTitle}</h3>
                  <p className="mt-1 text-xs text-muted">Issued {formatLearningDate(certificate.issuedAt)}</p>
                </div>
              </div>
              <span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${validity.tone}`}>{validity.label}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/api/learn/certificates/enrollment/${certificate.enrollmentId}`}
                aria-label={`Download certificate for ${certificate.courseTitle}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-bold text-teal-900 transition hover:bg-teal-100"
              >
                <Download aria-hidden="true" className="size-4" /> Download
              </Link>
              <Link
                href={`/certificates/${certificate.verificationCode}`}
                aria-label={`Verify certificate for ${certificate.courseTitle}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 transition hover:bg-mist-50"
              >
                Verify <ExternalLink aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
