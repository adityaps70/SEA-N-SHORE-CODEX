import { MediaImage } from '@/components/ui/media-image'
import { cn } from '@/lib/cn'
import type { MarketplaceCourse } from '../marketplace-repository'

/**
 * Round H (H6): who publishes a course, beside their name: the organization's logo when it has one,
 * otherwise the first letter of the trainer's or organization's name on navy. The name is always
 * shown next to it, so the image is decorative.
 */
export function CoursePublisherAvatar({
  course,
  className = 'size-9 text-xs',
  photoUrl = null,
}: {
  course: Pick<MarketplaceCourse, 'mentorName' | 'publisherLogoUrl'>
  /** Size and text size, e.g. "size-11 text-sm". */
  className?: string
  /** Round H (H7): the trainer's profile photo, used when there is no organization logo. */
  photoUrl?: string | null
}) {
  const initial = <span aria-hidden="true">{course.mentorName.charAt(0).toUpperCase()}</span>
  const logo = course.publisherLogoUrl
  if (!logo && photoUrl) {
    return (
      <span data-testid="course-publisher-avatar" className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-navy-950 font-extrabold text-white', className)}>
        <MediaImage src={photoUrl} alt="" fill avatar sizes="64px" fallback={initial} />
      </span>
    )
  }
  return (
    <span
      data-testid="course-publisher-avatar"
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden bg-navy-950 font-extrabold text-white',
        logo ? 'rounded-lg ring-1 ring-mist-100' : 'rounded-full',
        className,
      )}
    >
      {logo ? <MediaImage src={logo} alt="" fill sizes="44px" className="bg-white object-contain" fallback={initial} /> : initial}
    </span>
  )
}
