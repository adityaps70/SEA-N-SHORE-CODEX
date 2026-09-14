import { BadgeCheck, ShieldCheck, XCircle } from 'lucide-react'
import { certificateRepository } from '@/features/learning/certificate-repository'

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export default async function CertificateVerificationPage({
  params,
}: {
  params: Promise<{ verificationCode: string }>
}) {
  const { verificationCode } = await params
  const certificate = await certificateRepository.getCertificateByVerificationCode(verificationCode)

  if (!certificate) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center px-5 py-16">
        <section className="w-full rounded-[2rem] border border-rose-100 bg-white p-7 text-center shadow-[var(--shadow-card)] sm:p-10">
          <XCircle className="mx-auto size-10 text-rose-600" aria-hidden="true" />
          <h1 className="mt-4 text-3xl font-bold text-navy-950">Certificate not verified</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">
            No Sea N Shore Learning certificate matches this verification code. Check the code printed on the certificate and try again.
          </p>
        </section>
      </main>
    )
  }

  return (
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
  )
}
