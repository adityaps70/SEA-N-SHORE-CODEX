import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, EyeOff, ShieldCheck } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { InvitationResponse } from '@/features/learning/company-training/components/training-controls'
import { crewRepository } from '@/features/learning/company-training/crew-repository'
import { consentWording, CrewError, crewRefusalMessage } from '@/features/learning/company-training/crew-rules'
import { OrganizationLogo } from '@/features/organizations/components/organization-logo'

export const metadata: Metadata = { title: 'Crew training invitation' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * D3: a member answers a company's crew training invitation. Accepting is their consent to share, for the courses the
 * company assigns them, their progress and the certificate of those courses, and nothing else. Only the member the
 * invitation was sent to (by verified email) can answer it.
 */
export default async function CompanyInvitationPage({ params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params
  if (!UUID.test(invitationId)) notFound()
  const user = await requireAwsUser()
  const found = await crewRepository.invitationForMember(user.id, invitationId).catch((error: unknown) => {
    if (error instanceof CrewError) return { error: error.code }
    throw error
  })

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 max-md:px-0 max-md:py-0 sm:px-6">
      <MobilePageBar backHref="/learn/my-learning" title="Crew training" />
      <section className="rounded-[1.6rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] max-md:rounded-none max-md:border-0 max-md:shadow-none sm:p-8">
        {'error' in found ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-navy-950">This invitation can’t be answered here</h1>
            <p className="mt-3 text-sm leading-6 text-muted">{crewRefusalMessage(found.error)}</p>
            <Link href="/learn/my-learning" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900">Go to My Learning</Link>
          </>
        ) : (
          <InvitationBody found={found} invitationId={invitationId} />
        )}
      </section>
    </div>
  )
}

function InvitationBody({ found, invitationId }: { found: Awaited<ReturnType<typeof crewRepository.invitationForMember>>; invitationId: string }) {
  const { invitation } = found
  const wording = consentWording(invitation.companyName)
  return (
    <>
      <div className="flex items-center gap-3">
        <OrganizationLogo company={{ id: invitation.companyId, name: invitation.companyName, logoPath: invitation.companyLogoPath }} size="md" />
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Crew training</p>
          <h1 className="text-2xl font-bold tracking-tight text-navy-950">{invitation.companyName} invited you</h1>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-navy-900">
        {invitation.inviterName ? `${invitation.inviterName} from ${invitation.companyName}` : invitation.companyName} would like to give you course seats and follow your training. The courses are free for you.
      </p>

      {found.open ? (
        <InvitationResponse invitationId={invitationId}>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-emerald-900"><ShieldCheck aria-hidden="true" className="size-4" /> {invitation.companyName} will see</p>
              <ul className="mt-2 grid gap-1.5 text-sm text-emerald-950">
                {wording.shares.map((line) => <li key={line} className="flex gap-2"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{line}</li>)}
              </ul>
            </div>
            <div className="rounded-xl bg-mist-50 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-navy-950"><EyeOff aria-hidden="true" className="size-4" /> It will never see</p>
              <ul className="mt-2 grid gap-1.5 text-sm text-navy-900">
                {wording.neverShares.map((line) => <li key={line} className="flex gap-2"><span aria-hidden="true">·</span>{line}</li>)}
              </ul>
            </div>
          </div>
          <p className="text-xs leading-5 text-muted">You can stop sharing at any time from My Learning. Courses already given to you stay yours.</p>
        </InvitationResponse>
      ) : (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {found.status === 'accepted' ? `You already accepted. ${invitation.companyName}'s courses appear in My Learning.` : crewRefusalMessage('invitation_closed')}
        </p>
      )}
    </>
  )
}
