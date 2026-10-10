import { notFound } from 'next/navigation'
import { BadgeCheck, ShieldCheck } from 'lucide-react'
import { certificateRepository } from '@/features/learning/certificate-repository'
import { certificateDisplayNumber, certificateValidity } from '@/features/learning/certificate-settings'
import { CertificateNotVerified, isVerificationCode, isVisitor, JoinBar } from './certificate-verification-view'

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
  // A malformed code can never match (and would make the uuid comparison fail): 404 with the same page.
  if (!isVerificationCode(verificationCode)) notFound()
  const [certificate, visitor] = await Promise.all([
    certificateRepository.getCertificateByVerificationCode(verificationCode),
    isVisitor(),
  ])
  const joinBar = visitor ? <JoinBar /> : null
  const validity = certificateValidity(certificate?.expiresAt ?? null)

  if (!certificate) return <CertificateNotVerified joinBar={joinBar} />

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
                <p
                  className={`mt-4 inline-flex rounded-full px-3 py-1 text-sm font-bold ${validity.status === 'valid' ? 'bg-emerald-400/15 text-emerald-200' : 'bg-rose-400/15 text-rose-200'}`}
                  data-certificate-status={validity.status}
                >
                  {validity.status === 'valid' ? 'Valid' : `Expired on ${dateLabel(validity.expiresAt!)}`}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-6 sm:p-10 md:grid-cols-2">
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Certificate holder</p>
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
              <p className="mt-2 font-mono text-sm font-bold text-navy-950">{certificateDisplayNumber(certificate)}</p>
            </section>
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Completed</p>
              <p className="mt-2 font-semibold text-navy-950">{dateLabel(certificate.completedAt)}</p>
            </section>
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Issued</p>
              <p className="mt-2 font-semibold text-navy-950">{dateLabel(certificate.issuedAt)}</p>
            </section>
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Valid until</p>
              <p className="mt-2 font-semibold text-navy-950">{certificate.expiresAt ? dateLabel(certificate.expiresAt) : 'No expiry'}</p>
            </section>
            {certificate.signatoryName ? (
              <section>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Signed by</p>
                <p className="mt-2 font-semibold text-navy-950">{certificate.signatoryName}{certificate.signatoryTitle ? `, ${certificate.signatoryTitle}` : ''}</p>
              </section>
            ) : null}
          </div>
        </section>
      </main>
      {joinBar}
    </>
  )
}
