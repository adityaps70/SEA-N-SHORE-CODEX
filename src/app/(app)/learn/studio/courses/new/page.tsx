import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, BookOpen, ShieldCheck } from 'lucide-react'
import { CreateRequirementsBanner } from '@/components/creator/create-requirements-banner'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { CourseEditSession } from '@/features/learning/components/course-edit-session'
import { CourseForm } from '@/features/learning/components/course-form'
import { loadSellerFeeTerms } from '@/features/learning/course-seller-fees'
import { buildCoursePublisherOptions } from '@/features/learning/publishers'
import type { CourseDraftInput } from '@/features/learning/course-repository'
import { learningRepository } from '@/features/learning/repository'
import { organizationRepository } from '@/features/organizations/repository'
import { getOwnProfileFromAurora } from '@/features/profiles/repository'

export const metadata: Metadata = { title: 'Create a course' }

const initialCourse: CourseDraftInput = {
  slug: '',
  title: '',
  subtitle: null,
  description: '',
  category: 'Deck',
  level: 'beginner',
  language: 'English',
  thumbnailPath: null,
  trailerPath: null,
  learningOutcomes: [],
  requirements: [],
  targetAudience: [],
  accessType: 'free',
  priceMinor: 0,
  discountPriceMinor: null,
  currency: 'INR',
  certificateEnabled: false,
  courseFormat: 'recorded',
}

export default async function NewMentorCoursePage() {
  const user = await requireAwsUser()
  const [mentorState, access, profile, organizations] = await Promise.all([
    learningRepository.getMentorApplicationState(user.id),
    getAccessContext(user.id),
    getOwnProfileFromAurora(user.id),
    organizationRepository.listUserOrganizations(user.id),
  ])

  if (!profile) return redirect('/profile/edit')

  const hasActiveMentor = mentorState.kind === 'mentor' && mentorState.mentorStatus === 'active'
  const eligibleOrganizations = organizations.filter((organization) =>
    organization.role === 'owner'
    || organization.role === 'administrator'
    || organization.role === 'lms_manager')
  if (!hasActiveMentor && eligibleOrganizations.length === 0) {
    return redirect('/learn/teach')
  }

  const publisherOptions = buildCoursePublisherOptions(
    access,
    { profileId: profile.id, name: profile.fullName },
    eligibleOrganizations,
  ).filter((option) => hasActiveMentor || option.kind === 'organization')
  const feeEntries = await Promise.all(publisherOptions.map(async (option) => [
    option.key,
    await loadSellerFeeTerms(option.kind === 'organization' ? { companyId: option.id } : { profileId: option.id }),
  ] as const))
  const sellerFees = {
    default: feeEntries[0]?.[1] ?? null,
    byPublisherKey: Object.fromEntries(feeEntries),
  }

  return (
    <div className="mx-auto w-full max-w-6xl py-6 sm:px-6 lg:px-8">
      <CreateRequirementsBanner access={access} kind="course" organizations={organizations} className="mb-5" />
      <Link href="/learn/studio" className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> Learning Studio
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.75rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">
              <BookOpen aria-hidden="true" className="size-4" /> Course builder
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Create course</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/72 sm:text-base">
              Start with a focused maritime outcome, define who the course is for and save a private draft. Curriculum sections and lessons can be organized after the course foundation is created.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/75">
            <p className="inline-flex items-center gap-2 font-bold text-white">
              <ShieldCheck aria-hidden="true" className="size-4" /> Reviewed before publication
            </p>
            <p className="mt-1">Creating a draft does not publish it. Sea N Shore quality review remains required before learners can access the course.</p>
          </div>
        </div>
      </section>

      <div className="mt-5">
        <CourseEditSession>
          <CourseForm initialValue={initialCourse} publisherOptions={publisherOptions} sellerFees={sellerFees} />
        </CourseEditSession>
      </div>
    </div>
  )
}
