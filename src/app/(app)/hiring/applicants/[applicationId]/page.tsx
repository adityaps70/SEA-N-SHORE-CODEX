import type { Metadata } from 'next'
import Link from 'next/link'
import { jobMatchDisplay } from '@/features/jobs/match-display'
import { FileText, IdCard, Target } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { notFound } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { applicantPhotoUrl } from '@/features/jobs/applicant-media'
import { HIRING_APPLICATION_STATUS_BADGES, HIRING_APPLICATION_STATUS_LABELS } from '@/features/jobs/application-status'
import { ApplicantAvatar } from '@/features/jobs/components/applicant-avatar'
import { ApplicantMoreMenu } from '@/features/jobs/components/applicant-more-menu'
import { HiringCvLink, hiringCvHref } from '@/features/jobs/components/hiring-cv-link'
import { HiringStatusAction } from '@/features/jobs/components/hiring-status-action'
import { HiringStatusMobileBar } from '@/features/jobs/components/hiring-status-mobile-bar'
import { MessageApplicantButton } from '@/features/jobs/components/message-applicant-button'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { JobCompanyIdentity } from '@/features/jobs/components/job-company-identity'
import { RecruiterNoteForm } from '@/features/jobs/components/recruiter-note-form'
import { hiringRepository } from '@/features/jobs/hiring-repository'
import { getRelationshipState } from '@/features/network/queries'
import { relativeTimeFrom } from '@/lib/relative-time'
import { formatYears } from '@/lib/format'
import { dgProfileDownloadHref } from '@/features/profiles/profile-document-policy'
import { profileDocumentRepository } from '@/features/profiles/profile-document-repository'

export const metadata: Metadata = { title: 'Applicant' }

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date not recorded'
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date not recorded'
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export default async function HiringApplicantReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ applicationId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { applicationId } = await params
  if (!isUuid(applicationId)) notFound()
  const query = searchParams ? await searchParams : {}
  const cvProblem = firstValue(query.cv)

  const user = await requireAwsUser()
  const review = await hiringRepository.getApplicationReview(user.id, applicationId)
  if (!review) notFound()

  const candidate = review.candidate
  const matchDisplay = jobMatchDisplay(review.match)
  const profileHref = candidate.slug ? `/people/${candidate.slug}` : null
  const photoUrl = await applicantPhotoUrl(candidate.avatarPath)
  const dgProfile = candidate.accountActive && review.status !== 'withdrawn'
    ? await profileDocumentRepository.getDocument(candidate.id, 'dg_profile').catch(() => null)
    : null
  const isPersonalJob = review.job.companyId === null
  // Messaging follows the existing rule: accepted connections only. Inactive members can't be messaged.
  const canMessage = candidate.accountActive && candidate.id !== user.id
    ? await getRelationshipState(candidate.id).then((state) => state.connection.kind === 'connected').catch(() => false)
    : false
  const messageTarget = candidate.accountActive && candidate.id !== user.id ? { targetProfileId: candidate.id, canMessage } : null
  const applicantsHref = `/hiring/jobs/${review.job.id}/applicants`
  const cvHref = review.cvAttachment ? hiringCvHref(applicationId) : null
  const dgHref = dgProfile ? dgProfileDownloadHref(candidate.id) : null
  const phoneChip = 'relative inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[\'\'] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-0 pt-0 max-md:space-y-4 md:px-6 md:py-8 lg:px-8">
      <MobilePageBar
        backHref={applicantsHref}
        title="Applicant"
        right={<ApplicantMoreMenu candidateName={candidate.fullName} profileHref={candidate.accountActive ? profileHref : null} message={messageTarget} cvHref={cvHref} dgProfileHref={dgHref} applicantsHref={applicantsHref} />}
      />
      <div className="flex flex-col gap-4 max-md:hidden lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <JobCompanyIdentity
            name={review.job.companyName}
            companyId={review.job.companyId}
            companySlug={review.job.companySlug}
            logoPath={review.job.companyLogoPath}
            location={review.job.companyLocation}
            verified={review.job.companyVerified}
            size="sm"
            personalLabel="Personal recruiter"
          />
          <h1 className="mt-4 text-3xl font-bold text-navy-950">Candidate review</h1>
          <p className="mt-2 text-sm text-muted">{review.job.title} · Applied {formatDate(review.appliedAt)}</p>
        </div>
        <Link href={`/hiring/jobs/${review.job.id}/applicants`} className="inline-flex min-h-10 items-center self-start rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50">
          Back to applicants
        </Link>
      </div>

      <div className="max-md:hidden"><HiringSubnav active="jobs" /></div>

      {review.jobStatus !== 'published' ? (
        <p role="status" className="rounded-2xl border border-mist-200 bg-mist-50 px-4 py-3 text-sm font-semibold text-navy-900">
          {review.jobStatus === 'draft'
            ? 'This job is back in draft, so it is not taking new applications. You can still review this applicant.'
            : 'This job is archived, so it is not taking new applications. You can still review and update this applicant.'}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(19rem,0.75fr)]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:p-4 max-md:shadow-none sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-4 max-md:flex-col max-md:items-center max-md:gap-3 max-md:text-center">
                <ApplicantAvatar name={candidate.fullName} photoUrl={photoUrl} size="lg" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 max-md:justify-center">
                    <h2 className="min-w-0 break-words text-2xl font-bold text-navy-950 max-md:text-[22px]">{candidate.fullName}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${HIRING_APPLICATION_STATUS_BADGES[review.status]}`}>{HIRING_APPLICATION_STATUS_LABELS[review.status]}</span>
                  </div>
                  {candidate.headline ? <p className="mt-1 text-sm text-muted">{candidate.headline}</p> : null}
                  <p className="mt-1 text-xs font-semibold text-muted max-md:hidden">Applied {formatDateTime(review.appliedAt)}</p>
                  <p className="mt-1 text-[13px] text-muted md:hidden">Applied for {review.job.title} · {relativeTimeFrom(review.appliedAt) || formatDate(review.appliedAt)}</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2 md:hidden" aria-label="Applicant highlights">
                    <span className={`${phoneChip} bg-ocean-50 text-ocean-800`}><Target aria-hidden="true" className="size-4" />{matchDisplay ? matchDisplay.text : 'Not scored'}</span>
                    {cvHref ? <a href={cvHref} target="_blank" rel="noreferrer" className={`${phoneChip} bg-mist-50 text-navy-900 hover:bg-mist-100`}><FileText aria-hidden="true" className="size-4" />CV (PDF)</a> : null}
                    {dgHref ? <a href={dgHref} target="_blank" rel="noopener noreferrer" className={`${phoneChip} bg-mist-50 text-navy-900 hover:bg-mist-100`}><IdCard aria-hidden="true" className="size-4" />DG profile</a> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 max-md:mt-3 max-md:justify-center">
                    {profileHref ? <Link href={profileHref} className="inline-flex text-sm font-bold text-teal-700 hover:underline max-md:min-h-10 max-md:items-center">View Maritime Profile</Link> : null}
                    {messageTarget ? <MessageApplicantButton targetProfileId={candidate.id} candidateName={candidate.fullName} canMessage={canMessage} /> : null}
                  </div>
                  {!candidate.accountActive ? <p className="mt-2 text-sm font-semibold text-amber-900">This member’s account is no longer active, so their profile can’t be opened. The application is kept for your records.</p> : null}
                </div>
              </div>
              <div className="rounded-2xl bg-navy-950 px-5 py-4 text-white max-md:hidden sm:text-right">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/60">Match</p>
                {/* Round 12: the same numbers and labels the candidate sees. */}
                {matchDisplay && matchDisplay.band !== 'low' ? <p className="mt-1 text-4xl font-black">{matchDisplay.score}%</p> : <p className="mt-1 text-2xl font-black">{matchDisplay ? matchDisplay.label : 'Not scored'}</p>}
                <p className="mt-1 text-xs text-white/65">{matchDisplay && matchDisplay.band !== 'low' ? matchDisplay.label : 'Structured maritime fit'}</p>
              </div>
            </div>

            <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl bg-mist-50 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-muted">Rank</dt><dd className="mt-1 font-semibold text-navy-950">{candidate.rank ?? 'Not listed'}</dd></div>
              <div className="rounded-xl bg-mist-50 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-muted">Sea experience</dt><dd className="mt-1 font-semibold text-navy-950">{formatYears(candidate.sailingExperienceYears)}</dd></div>
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

          <section aria-labelledby="applicant-message-heading" className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <h2 id="applicant-message-heading" className="text-xl font-bold text-navy-950">Message from the applicant</h2>
            {review.coverNote ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ink">{review.coverNote}</p>
            ) : (
              <p className="mt-2 text-sm text-muted">The applicant applied with their Sea N Shore profile and did not add a message.</p>
            )}
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
            <p className="mt-1 text-sm text-muted">Every status change is kept. The applicant sees these steps, with your messages, on their own timeline.</p>
            <div className="mt-5 space-y-4 border-l-2 border-mist-100 pl-5">
              {review.events.length ? review.events.map((event) => (
                <article key={event.id} className="relative">
                  <span className="absolute -left-[1.65rem] top-1.5 size-3 rounded-full border-2 border-white bg-teal-600" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold text-navy-950">{HIRING_APPLICATION_STATUS_LABELS[event.status]}</h3>
                    <time dateTime={event.createdAt} className="text-xs font-semibold text-muted">{formatDateTime(event.createdAt)}</time>
                  </div>
                  {event.note ? <p className="mt-1 text-sm leading-6 text-muted">{event.note}</p> : null}
                </article>
              )) : (
                <article className="relative">
                  <span className="absolute -left-[1.65rem] top-1.5 size-3 rounded-full border-2 border-white bg-teal-600" />
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-navy-950">{HIRING_APPLICATION_STATUS_LABELS.applied}</h3><time dateTime={review.appliedAt} className="text-xs font-semibold text-muted">{formatDateTime(review.appliedAt)}</time></div>
                </article>
              )}
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <h2 className="text-xl font-bold text-navy-950">Private recruiter notes</h2>
            <p className="mt-1 text-sm text-muted">Internal screening context is never shown on the candidate-facing application timeline.</p>
            <div className="mt-5"><RecruiterNoteForm applicationId={applicationId} audience={isPersonalJob ? 'personal' : 'organization'} /></div>
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

        <aside className="min-w-0 space-y-6 max-md:space-y-4">
          <div className="max-md:hidden"><HiringStatusAction applicationId={applicationId} currentStatus={review.status} /></div>

          <section aria-labelledby="candidate-cv-heading" className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Candidate CV</p>
            <h2 id="candidate-cv-heading" className="mt-1 text-lg font-bold text-navy-950">Attached application document</h2>
            {review.cvAttachment ? (
              <>
                <p className="mt-1 text-sm leading-6 text-muted">Private to authorized hiring reviewers for this vacancy.</p>
                {cvProblem === 'unavailable' ? (
                  <p role="alert" className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900">
                    The CV could not be opened just now. Try again in a moment.
                  </p>
                ) : null}
                {cvProblem === 'missing' ? (
                  <p role="alert" className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900">
                    This CV file is no longer stored on Sea N Shore. Message the applicant to ask for a new copy.
                  </p>
                ) : null}
                <div className="mt-4">
                  <HiringCvLink
                    applicationId={applicationId}
                    fileName={review.cvAttachment.fileName}
                    sizeBytes={review.cvAttachment.sizeBytes}
                  />
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-muted">
                The applicant did not attach a CV. Their Sea N Shore profile details are shown on this page.
              </p>
            )}
            {dgProfile ? (
              <div className="mt-5 border-t border-mist-100 pt-4">
                <h3 className="text-sm font-bold text-navy-950">DG Shipping profile</h3>
                <p className="mt-1 text-sm leading-6 text-muted">The seafarer&apos;s profile PDF from the DG Shipping portal, shared privately with employers they apply to.</p>
                <a
                  href={dgProfileDownloadHref(candidate.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex min-h-11 w-full min-w-0 flex-col justify-center rounded-xl border border-mist-200 px-4 py-2 text-sm font-semibold text-navy-950 transition hover:border-ocean-200 hover:bg-ocean-50"
                >
                  <span>Open DG profile (PDF)</span>
                  <span className="block truncate text-xs font-medium text-muted">{dgProfile.fileName}</span>
                </a>
              </div>
            ) : null}
          </section>

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

          <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:hidden sm:p-6">
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

      <HiringStatusMobileBar applicationId={applicationId} currentStatus={review.status} candidateName={candidate.fullName} />
    </div>
  )
}
