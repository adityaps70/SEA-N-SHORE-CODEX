import Link from '@/components/navigation/intent-link'
import { MediaImage } from '@/components/ui/media-image'
import type { MemberNumber } from '../queries'
import type { AboutPartner, AboutPerson } from '../schemas'

/**
 * Round H (H7): the owner-filled About page sections. The page renders a section only when it has
 * content; images are uploaded by an administrator and shown through signed links (`imageUrls`).
 */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)![0] : '')).toUpperCase() || '?'
}

function isExternal(href: string) {
  return /^https:\/\//.test(href)
}

function PersonCard({ person, imageUrl }: { person: AboutPerson; imageUrl: string | null }) {
  const fallback = (
    <span aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-full bg-mist-100 text-lg font-bold text-navy-950">{initials(person.name)}</span>
  )
  return (
    <li className="flex gap-4 rounded-2xl border border-mist-100 bg-white p-4">
      {imageUrl ? (
        <span className="relative block size-16 shrink-0 overflow-hidden rounded-full bg-mist-100">
          <MediaImage avatar src={imageUrl} alt="" fill sizes="64px" className="object-cover" fallback={fallback} />
        </span>
      ) : fallback}
      <div className="min-w-0">
        <p className="font-semibold text-navy-950">
          {person.profileUrl && isExternal(person.profileUrl) ? (
            <a href={person.profileUrl} rel="noopener noreferrer" target="_blank" className="hover:underline">
              {person.name}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : person.profileUrl ? (
            <Link href={person.profileUrl} className="hover:underline">{person.name}</Link>
          ) : person.name}
        </p>
        {person.role ? <p className="text-sm font-medium text-ocean-700">{person.role}</p> : null}
        {person.bio ? <p className="mt-1 text-sm leading-6 text-muted max-md:text-base">{person.bio}</p> : null}
      </div>
    </li>
  )
}

export function AboutPeopleSection({ id, title, people, imageUrls }: { id: string; title: string; people: AboutPerson[]; imageUrls: Record<string, string> }) {
  if (!people.length) return null
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="text-xl font-bold tracking-tight text-navy-950">{title}</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {people.map((person, index) => (
          <PersonCard key={`${person.name}-${index}`} person={person} imageUrl={person.photoPath ? imageUrls[person.photoPath] ?? null : null} />
        ))}
      </ul>
    </section>
  )
}

export function AboutPartnersSection({ partners, imageUrls }: { partners: AboutPartner[]; imageUrls: Record<string, string> }) {
  if (!partners.length) return null
  return (
    <section aria-labelledby="about-partners" className="mt-8">
      <h2 id="about-partners" className="text-xl font-bold tracking-tight text-navy-950">Partners</h2>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {partners.map((partner, index) => {
          const logo = partner.logoPath ? imageUrls[partner.logoPath] ?? null : null
          const content = (
            <>
              {logo ? (
                <span className="relative block h-14 w-full">
                  <MediaImage src={logo} alt={`${partner.name} logo`} fill sizes="(min-width: 640px) 200px, 45vw" className="object-contain" />
                </span>
              ) : null}
              <span className={logo ? 'sr-only' : 'text-sm font-semibold text-navy-950'}>{partner.name}</span>
            </>
          )
          return (
            <li key={`${partner.name}-${index}`} className="flex min-h-24 items-center justify-center rounded-2xl border border-mist-100 bg-white p-4 text-center">
              {partner.websiteUrl ? (
                <a href={partner.websiteUrl} rel="noopener noreferrer" target="_blank" className="flex w-full flex-col items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ocean-500">
                  {content}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : <span className="flex w-full flex-col items-center justify-center">{content}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function AboutNumbersSection({ numbers }: { numbers: MemberNumber[] }) {
  if (!numbers.length) return null
  return (
    <section aria-labelledby="about-numbers" className="mt-8">
      <h2 id="about-numbers" className="text-xl font-bold tracking-tight text-navy-950">Sea N Shore today</h2>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {numbers.map((entry) => (
          <div key={entry.key} className="flex flex-col-reverse rounded-2xl border border-mist-100 bg-white p-4">
            <dt className="text-sm font-medium text-muted">{entry.label}</dt>
            <dd className="text-3xl font-bold tracking-tight text-navy-950">{entry.value.toLocaleString('en-IN')}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
