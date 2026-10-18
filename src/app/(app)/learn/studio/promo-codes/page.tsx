import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Tag } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { PromoCodeForm } from '@/features/learning/components/promo-code-form'
import { PromoCodeToggle } from '@/features/learning/components/promo-code-toggle'
import { promoCodeRepository, type PromoCodeSummary } from '@/features/learning/promo-code-repository'
import { promoTermsLabel } from '@/features/learning/promo-codes'
import { learningRepository } from '@/features/learning/repository'
import { organizationRepository } from '@/features/organizations/repository'
import { formatMoney } from '@/features/payments/currency'

export const metadata: Metadata = { title: 'Promo codes' }

function dateLabel(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value))
}

function windowLabel(code: PromoCodeSummary) {
  const from = dateLabel(code.validFrom)
  const until = dateLabel(code.validUntil)
  if (from && until) return `${from} – ${until}`
  if (from) return `From ${from}`
  if (until) return `Until ${until}`
  return 'No end date'
}

function status(code: PromoCodeSummary) {
  if (code.disabled) return { label: 'Off', tone: 'bg-mist-100 text-navy-700' }
  if (code.validUntil && Date.parse(code.validUntil) <= Date.now()) return { label: 'Expired', tone: 'bg-rose-50 text-rose-700' }
  if (code.usageLimit !== null && code.redemptions >= code.usageLimit) return { label: 'Used up', tone: 'bg-amber-50 text-amber-900' }
  if (code.validFrom && Date.parse(code.validFrom) > Date.now()) return { label: 'Scheduled', tone: 'bg-sky-50 text-sky-900' }
  return { label: 'Active', tone: 'bg-emerald-50 text-emerald-800' }
}

/** Round C (C2): a trainer's promo codes, their redemptions and the revenue taken through each. */
export default async function PromoCodesPage() {
  const user = await requireAwsUser()
  const [mentorState, organizations] = await Promise.all([
    learningRepository.getMentorApplicationState(user.id),
    organizationRepository.listUserOrganizations(user.id),
  ])
  const hasActiveMentor = mentorState.kind === 'mentor' && mentorState.mentorStatus === 'active'
  const hasOrganizationLmsAccess = organizations.some((organization) =>
    organization.role === 'owner' || organization.role === 'administrator' || organization.role === 'lms_manager')
  if (!hasActiveMentor && !hasOrganizationLmsAccess) return redirect('/learn/teach')

  let codes: PromoCodeSummary[] | null = null
  let courses: Array<{ id: string; title: string }> = []
  try {
    ;[codes, courses] = await Promise.all([promoCodeRepository.listForManager(user.id), promoCodeRepository.listCodeCourses(user.id)])
  } catch (error) {
    console.error('promo_codes_load_failed', { message: error instanceof Error ? error.message : null })
  }

  return (
    <div className="mx-auto w-full max-w-page-wide py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref="/learn/studio" title="Promo codes" />
      <Link href="/learn/studio" className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline max-md:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" /> Learning Studio
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] max-md:mt-3 sm:p-8">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200"><Tag aria-hidden="true" className="size-4" /> Your paid courses</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Promo codes</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
          Give a percentage or an amount off one course or all your courses, with a limit on total uses, uses per member and dates. Buyers type the code at checkout; Sea N Shore works out the price.
        </p>
      </section>

      <div className="mt-5">
        {courses.length || hasActiveMentor ? (
          <PromoCodeForm courses={courses} canCodeAllCourses={hasActiveMentor} />
        ) : (
          <p className="rounded-2xl border border-mist-100 bg-white p-5 text-sm text-muted">Publish a paid course to make promo codes for it.</p>
        )}
      </div>

      <section aria-labelledby="codes-heading" className="mt-6">
        <h2 id="codes-heading" className="text-lg font-bold text-navy-950">Your codes</h2>
        {codes === null ? (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">We could not load your codes just now. Refresh the page to try again.</p>
        ) : codes.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-mist-100 bg-white p-5 text-sm text-muted">No codes yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {codes.map((code) => {
              const state = status(code)
              return (
                <li key={code.id} className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-lg font-extrabold text-navy-950">{code.code}</p>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${state.tone}`}>{state.label}</span>
                      </div>
                      <p className="text-sm font-semibold text-navy-900">{promoTermsLabel(code.terms)} · {code.courseTitle ?? 'All my courses'}</p>
                      <p className="text-xs text-muted">
                        {windowLabel(code)} · {code.usageLimit === null ? 'No total limit' : `${code.usageLimit} uses in total`} · {code.perMemberLimit === null ? 'no limit per member' : `${code.perMemberLimit} per member`}
                      </p>
                      <dl className="grid gap-x-5 gap-y-0.5 pt-2 text-sm text-navy-800 sm:grid-cols-[auto_1fr]">
                        <dt className="font-semibold">Redemptions</dt>
                        <dd>{code.redemptions}{code.usageLimit !== null ? ` of ${code.usageLimit}` : ''}</dd>
                        {code.revenue.map((revenue) => (
                          <div key={revenue.currency} className="contents">
                            <dt className="font-semibold">Revenue ({revenue.currency})</dt>
                            <dd>
                              {formatMoney(revenue.grossMinor, revenue.currency)} paid, {formatMoney(revenue.discountMinor, revenue.currency)} discount given
                              {revenue.refunds ? ` · ${revenue.refunds} refunded` : ''}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                    <PromoCodeToggle codeId={code.id} disabled={code.disabled} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
