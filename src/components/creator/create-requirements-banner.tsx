import Link from 'next/link'
import { ArrowRight, Info } from 'lucide-react'
import { canUseCapability, type AccessContext, type Capability, type VerificationType } from '@/features/access/policy'

export type CreateKind = 'job' | 'event' | 'course'

type CreateRule = {
  capability: Extract<Capability, 'job.publish' | 'event.publish' | 'course.publish'>
  verification: VerificationType
  verificationLabel: string
  /** Same destinations as the Create workspace (src/app/(app)/creator/page.tsx). */
  verificationHref: string
  noun: string
}

const RULES: Record<CreateKind, CreateRule> = {
  job: {
    capability: 'job.publish',
    verification: 'recruiter',
    verificationLabel: 'Get verified as a recruiter',
    verificationHref: '/settings/verifications/recruiter',
    noun: 'this job',
  },
  event: {
    capability: 'event.publish',
    verification: 'event_host',
    verificationLabel: 'Get verified as an Event Host',
    verificationHref: '/settings/verifications/event-host',
    noun: 'this event',
  },
  course: {
    capability: 'course.publish',
    verification: 'trainer',
    verificationLabel: 'Get verified as a trainer',
    verificationHref: '/learn/teach',
    noun: 'this course',
  },
}

export type CreateRequirement = {
  id: 'account' | 'verification' | 'plan'
  label: string
  href: string
  linkLabel: string
}

/**
 * What this member still needs before they can publish, using the same rules as the Create
 * workspace: publishing is possible personally (verified + entitled) or for any organization
 * they manage. Returns an empty list when they can already publish either way.
 */
export function getCreateRequirements(access: AccessContext, kind: CreateKind): CreateRequirement[] {
  const rule = RULES[kind]
  const personalReady = canUseCapability(access, rule.capability)
  const organizationReady = access.organizationMemberships.some((membership) =>
    canUseCapability(access, rule.capability, { companyId: membership.companyId }))
  if (personalReady || organizationReady) return []

  const missing: CreateRequirement[] = []
  if (!access.accountActive) {
    missing.push({
      id: 'account',
      label: 'Your account is not active, so publishing is paused',
      href: '/help',
      linkLabel: 'Contact support',
    })
  }
  if (!access.verifications.includes(rule.verification)) {
    missing.push({ id: 'verification', label: rule.verificationLabel, href: rule.verificationHref, linkLabel: 'Get verified' })
  }
  if (!access.personalEntitlements.includes(rule.capability)) {
    missing.push({ id: 'plan', label: 'Creator Pro to publish under your own name', href: '/plans', linkLabel: 'See plans' })
  }
  return missing
}

/**
 * Slim notice at the top of a create page listing only what the member is missing to publish,
 * each with a direct link. Renders nothing when the member can already publish.
 */
export function CreateRequirementsBanner({ access, kind, className = '' }: { access: AccessContext; kind: CreateKind; className?: string }) {
  const missing = getCreateRequirements(access, kind)
  if (!missing.length) return null
  const headingId = `create-requirements-${kind}`

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-xl border border-ocean-100 bg-ocean-50 px-4 py-3 text-sm text-navy-900 ${className}`.trim()}
    >
      <div className="flex items-start gap-2.5">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ocean-700" />
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-semibold text-navy-950">
            To publish {RULES[kind].noun}, you still need:
          </h2>
          <ul className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-5">
            {missing.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{item.label}</span>
                <Link
                  href={item.href}
                  className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-ocean-200 bg-white px-2.5 text-xs font-bold text-ocean-700 transition hover:border-ocean-300 hover:bg-ocean-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40"
                >
                  {item.linkLabel} <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">You can save a draft now and publish it once this is done.</p>
        </div>
      </div>
    </section>
  )
}
