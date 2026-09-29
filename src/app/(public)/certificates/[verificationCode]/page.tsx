import Link from 'next/link'
import { BadgeCheck, ShieldCheck, XCircle } from 'lucide-react'
import { getVerifiedUser } from '@/features/auth/queries'
import { certificateRepository } from '@/features/learning/certificate-repository'

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

/** Signed-out visitor? Fails open to "visitor" so the page still renders if auth is down. */
async function isVisitor() {
  try {
    return !(await getVerifiedUser())
  } catch {
    return true
  }
}

/**
 * Phones, signed-out visitors only: a slim invitation to join, stuck to the bottom of the
 * screen. It is `sticky` (not fixed) right after <main>, so it stops above the site footer
 * instead of covering it.
 */
function JoinBar() {
  return (
    <aside
      aria-label="Join Sea N Shore"
      className="sticky bottom-0 z-40 border-t border-mist-100 bg-white px-4 pb-[calc(0.625rem+env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-8px_24px_-12px_rgb(7_27_45/0.25)] md:hidden"
      data-certificate-join-bar=""
    >
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <p className="min-w-0 flex-1 text-sm leading-5 text-muted">
          <span className="block truncate font-semibold text-navy-950">Join Sea N Shore</span>
          <span className="block truncate">Courses with certificates you can show</span>
        </p>
        <Link
          href="/auth/sign-up"
          className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-ocean-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
        >
          Join now
        </Link>
      </div>
    </aside>
  )
}

export default async function CertificateVerificationPage({
  params,
}: {
  params: Promise<{ verificationCode: string }>
}) {
  const { verificationCode } = await params
  const [certificate, visitor] = await Promise.all([
    certificateRepository.getCertificateByVerificationCode(verificationCode),
    isVisitor(),
  ])
  const joinBar = visitor ? <JoinBar /> : null

  if (!certificate) {
    return (
      <>
        <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center px-5 py-16">
          <section className="w-full rounded-[2rem] border border-rose-100 bg-white p-7 text-center shadow-[var(--shadow-card)] sm:p-10">
            <XCircle className="mx-auto size-10 text-rose-600" aria-hidden="true" />
            <h1 className="mt-4 text-3xl font-bold text-navy-950">Certificate not verified</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">
              No Sea N Shore Learning certificate matches this verification code. Check the code printed on the certificate and try again.
            </p>
          </section>
        </main>
        {joinBar}
      </>
    )
  }

  return (
    <>
      <main className="mx-auto max-w-4xl px-5 py-12 sm:py-16">
        <section className="overflow-hidden rounded-[2rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
          <div className="bg-navy-950 px-6 py-8 text-white sm:px-10">
            <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold uppercase tracking-[0.16em] text-teal-200">
              <ShieldCheck className="size-4" aria-hidden="true" /> Sea N Shore Learning verification
            </div>
            <div className="mt-5 flex items-start gap-4">
              <BadgeCheck className="mt-1 size-9 shrink-0 text-teal-300" aria-hidden="true" />
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Certificate verified</h1>
                <p className="mt-2 text-sm leading-6 text-white/70">This completion record matches an immutable Sea N Shore Learning certificate.</p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-6 sm:p-10 md:grid-cols-2">
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Learner</p>
              <p className="mt-2 text-xl font-bold text-navy-950">{certificate.learnerName}</p>
            </section>
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Course</p>
              <p className="mt-2 text-xl font-bold text-navy-950">{certificate.courseTitle}</p>
            </section>
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Mentor</p>
              <p className="mt-2 font-bold text-navy-950">{certificate.mentorName}</p>
            </section>
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Certificate number</p>
              <p className="mt-2 font-mono text-sm font-bold text-navy-950">{certificate.certificateNumber}</p>
            </section>
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Completed</p>
              <p className="mt-2 font-semibold text-navy-950">{dateLabel(certificate.completedAt)}</p>
            </section>
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Issued</p>
              <p className="mt-2 font-semibold text-navy-950">{dateLabel(certificate.issuedAt)}</p>
            </section>
          </div>
        </section>
      </main>
      {joinBar}
    </>
  )
}
