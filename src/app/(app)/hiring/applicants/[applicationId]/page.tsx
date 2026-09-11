import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { HiringStatusAction } from '@/features/jobs/components/hiring-status-action'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { RecruiterNoteForm } from '@/features/jobs/components/recruiter-note-form'
import { hiringRepository } from '@/features/jobs/hiring-repository'
import { JOB_APPLICATION_STATUS_LABELS } from '@/features/jobs/types'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'SN'
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export default async function HiringApplicantReviewPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params
  if (!isUuid(applicationId)) notFound()

  const user = await requireAwsUser()
  const review = await hiringRepository.getApplicationReview(user.id, applicationId)
  if (!review) notFound()

  const candidate = review.candidate
  const profileHref = candidate.slug ? `/people/${candidate.slug}` : null

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">{review.job.companyName}</p>
          <h1 className="mt-2 text-3xl font-bold text-navy-950">Candidate review</h1>
          <p className="mt-2 text-sm text-muted">{review.job.title} · Applied {formatDate(review.appliedAt)}</p>
        </div>
        <Link href={`/hiring/jobs/${review.job.id}/applicants`} className="rounded-xl border border-mist-100 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50">
          Back to applicants
        </Link>
      </div>

      <HiringSubnav active="jobs" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(19rem,0.75fr)]">
        <div className="space-y-6">
          <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-4">
                <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-navy-950 text-base font-black text-white">
                  {initials(candidate.fullName)}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-bold text-navy-950">{candidate.fullName}</h2>
                    <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold text-muted">{JOB_APPLICATION_STATUS_LABELS[review.status]}</span>
                  </div>
                  {candidate.headline ? <p className="mt-1 text-sm text-muted">{candidate.headline}</p> : null}
                  {profileHref ? <Link href={profileHref} className="mt-2 inline-flex text-sm font-bold text-teal-700 hover:underline">View Maritime Profile</Link> : null}
                </div>
              </div>
              <div className="rounded-2xl bg-navy-950 px-5 py-4 text-white sm:text-right">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/60">Match</p>
                <p className="mt-1 text-4xl font-black">{review.match.score}%</p>
                <p className="mt-1 text-xs text-white/65">Structured maritime fit</p>
              </div>
            </div>

            <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-mist-50 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-muted">Rank</dt><dd className="mt-1 font-semibold text-navy-950">{candidate.rank ?? 'Not listed'}</dd></div>
              <div className="rounded-xl bg-mist-50 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-muted">Sea experience</dt><dd className="mt-1 font-semibold text-navy-950">{candidate.sailingExperienceYears === null ? 'Not listed' : `${candidate.sailingExperienceYears} years`}</dd></div>
              <div className="rounded-xl bg-mist-50 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-muted">Availability</dt><dd className="mt-1 font-semibold text-navy-950">{candidate.availability ?? 'Not listed'}</dd></div>
              <div className="rounded-xl bg-mist-50 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-muted">Location</dt><dd className="mt-1 font-semibold text-navy-950">{candidate.location ?? 'Not listed'}</dd></div>
            </dl>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-bold text-navy-950">Vessel experience</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {candidate.vesselTypes.length ? candidate.vesselTypes.map((item) => <span key={item} className="rounded-full border border-mist-100 px-2.5 py-1 text-xs font-semibold text-muted">{item}</span>) : <span className="text-sm text-muted">Not listed</span>}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-bold text-navy-950">Trading areas</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {candidate.tradingAreas.length ? candidate.tradingAreas.map((item) => <span key={item} className="rounded-full border border-mist-100 px-2.5 py-1 text-xs font-semibold text-muted">{item}</span>) : <span className="text-sm text-muted">Not listed</span>}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Explainable fit</p>
              <h2 className="mt-1 text-xl font-bold text-navy-950">Why this candidate matches</h2>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-emerald-50 p-4">
                <h3 className="font-bold text-emerald-950">Matched signals</h3>
                <ul className="mt-3 space-y-2 text-sm text-emerald-900">
                  {review.match.reasons.length ? review.match.reasons.map((reason) => <li key={reason}>✓ {reason}</li>) : <li>No strong structured match signals yet.</li>}
                </ul>
              </div>
              <div className="rounded-2xl bg-amber-50 p-4">
                <h3 className="font-bold text-amber-950">Missing requirements</h3>
                <ul className="mt-3 space-y-2 text-sm text-amber-900">
                  {review.match.missingRequirements.length ? review.match.missingRequirements.map((requirement) => <li key={requirement}>• {requirement}</li>) : <li>No required profile gaps detected.</li>}
                </ul>
              </div>
            </div>

            {review.match.warnings.length ? (
              <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 p-4">
                <h3 className="font-bold text-rose-950">Eligibility warnings</h3>
                <ul className="mt-2 space-y-1 text-sm text-rose-900">{review.match.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>
              </div>
            ) : null}
          </section>

          <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <h2 className="text-xl font-bold text-navy-950">Application timeline</h2>
            <p className="mt-1 text-sm text-muted">Status history is retained as recruitment progresses.</p>
            <div className="mt-5 space-y-4 border-l-2 border-mist-100 pl-5">
              {review.events.length ? review.events.map((event) => (
                <article key={event.id} className="relative">
                  <span className="absolute -left-[1.65rem] top-1.5 size-3 rounded-full border-2 border-white bg-teal-600" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold text-navy-950">{JOB_APPLICATION_STATUS_LABELS[event.status]}</h3>
                    <time className="text-xs font-semibold text-muted">{formatDate(event.createdAt)}</time>
                  </div>
                  {event.note ? <p className="mt-1 text-sm leading-6 text-muted">{event.note}</p> : null}
                </article>
              )) : (
                <article className="relative">
                  <span className="absolute -left-[1.65rem] top-1.5 size-3 rounded-full border-2 border-white bg-teal-600" />
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-navy-950">Applied</h3><time className="text-xs font-semibold text-muted">{formatDate(review.appliedAt)}</time></div>
                </article>
              )}
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <h2 className="text-xl font-bold text-navy-950">Private recruiter notes</h2>
            <p className="mt-1 text-sm text-muted">Internal screening context is never shown on the candidate-facing application timeline.</p>
            <div className="mt-5"><RecruiterNoteForm applicationId={applicationId} /></div>
            <div className="mt-5 space-y-3">
              {review.recruiterNotes.map((note) => (
                <article key={note.id} className="rounded-xl bg-mist-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wide text-muted">Recruiter note</p><time className="text-xs font-semibold text-muted">{formatDate(note.createdAt)}</time></div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-navy-950">{note.note}</p>
                </article>
              ))}
              {review.recruiterNotes.length === 0 ? <p className="text-sm text-muted">No private notes yet.</p> : null}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <HiringStatusAction applicationId={applicationId} currentStatus={review.status} />

          <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <h2 className="text-lg font-bold text-navy-950">Credentials & visas</h2>
            <div className="mt-4 space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Certificates</h3>
                <div className="mt-2 space-y-2">
                  {candidate.certificates.length ? candidate.certificates.map((credential) => (
                    <div key={`${credential.name}-${credential.expiresAt ?? ''}`} className="rounded-xl bg-mist-50 p-3 text-sm">
                      <p className="font-semibold text-navy-950">{credential.name}</p>
                      <p className="mt-0.5 text-xs text-muted">{credential.verified ? 'Verified' : 'Not verified'}{credential.expiresAt ? ` · Expires ${formatDate(credential.expiresAt)}` : ''}</p>
                    </div>
                  )) : <p className="text-sm text-muted">No credentials listed.</p>}
                </div>
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Visas</h3>
                <div className="mt-2 flex flex-wrap gap-2">{candidate.visas.length ? candidate.visas.map((visa) => <span key={visa} className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-semibold text-navy-950">{visa}</span>) : <span className="text-sm text-muted">No active visas listed.</span>}</div>
              </div>
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Vacancy</p>
            <h2 className="mt-1 text-lg font-bold text-navy-950">{review.job.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{review.job.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-muted">
              {review.job.rank ? <span className="rounded-full border border-mist-100 px-2.5 py-1">{review.job.rank}</span> : null}
              {review.job.vesselTypes.slice(0, 2).map((item) => <span key={item} className="rounded-full border border-mist-100 px-2.5 py-1">{item}</span>)}
              {review.job.location ? <span className="rounded-full border border-mist-100 px-2.5 py-1">{review.job.location}</span> : null}
            </div>
          </section>
        </aside>
      </div>
    </main>
  )
}
