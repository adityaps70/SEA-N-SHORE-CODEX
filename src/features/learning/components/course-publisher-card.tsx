import IntentLink from '@/components/navigation/intent-link'
import { BadgeCheck } from 'lucide-react'
import type { MarketplaceCourse } from '../marketplace-repository'
import type { CoursePublisherCard as CoursePublisherCardData } from '../course-page-repository'
import { CoursePublisherAvatar } from './course-publisher-avatar'

/**
 * Round H (H7): "About the trainer" / "About the organization" on the course page: the photo or logo, name,
 * short bio, and up to three of their other courses, linking to the trainer's or organization's page.
 */
export function CoursePublisherCard({
  course,
  publisher,
  photoUrl,
  className = '',
}: {
  course: Pick<MarketplaceCourse, 'mentorName' | 'publisherLogoUrl'>
  publisher: CoursePublisherCardData
  photoUrl: string | null
  className?: string
}) {
  const organization = publisher.kind === 'organization'
  const heading = organization ? 'About the organization' : 'About the trainer'
  return (
    <section aria-labelledby="course-publisher-heading" className={className}>
      <h2 id="course-publisher-heading" className="text-section-title font-bold text-navy-950 max-md:text-lg">{heading}</h2>
      <div className="mt-4 flex items-start gap-4">
        <CoursePublisherAvatar
          course={{ mentorName: publisher.name, publisherLogoUrl: publisher.logoUrl ?? course.publisherLogoUrl }}
          photoUrl={photoUrl}
          className="size-16 text-lg"
        />
        <div className="min-w-0">
          {publisher.href ? (
            <IntentLink href={publisher.href} className="text-card-title font-bold text-ocean-700 underline-offset-2 hover:underline">
              {publisher.name}
            </IntentLink>
          ) : (
            <p className="text-card-title font-bold text-navy-950">{publisher.name}</p>
          )}
          <p className="mt-1 inline-flex items-center gap-1 text-meta font-semibold text-teal-800">
            <BadgeCheck aria-hidden="true" className="size-3.5" /> {organization ? 'Verified organization' : 'Verified trainer'}
          </p>
          {publisher.bio ? <p className="mt-2 text-sm leading-6 text-navy-900">{publisher.bio}</p> : null}
        </div>
      </div>
      {publisher.otherCourses.length ? (
        <div className="mt-5">
          <h3 className="text-sm font-bold text-navy-950">More courses by {publisher.name}</h3>
          <ul className="mt-2 divide-y divide-mist-100">
            {publisher.otherCourses.map((other) => (
              <li key={other.id}>
                <IntentLink href={`/learn/courses/${other.slug}`} className="flex min-h-11 items-center py-2 text-sm font-semibold text-navy-950 hover:text-ocean-700 hover:underline">
                  {other.title}
                </IntentLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {publisher.href ? (
        <IntentLink href={publisher.href} className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-ocean-700 underline-offset-2 hover:underline">
          {organization ? 'View organization page' : 'View trainer profile'}
          <span className="sr-only">: {publisher.name}</span>
        </IntentLink>
      ) : null}
    </section>
  )
}
