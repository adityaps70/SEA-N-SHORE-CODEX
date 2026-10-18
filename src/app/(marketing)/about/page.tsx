import type { Metadata } from 'next'
import { AboutNumbersSection, AboutPartnersSection, AboutPeopleSection } from '@/features/site-settings/components/about-sections'
import { getAboutPageContent, getMemberNumbers } from '@/features/site-settings/queries'
import { signedAboutImageUrls } from '@/features/site-settings/images'
import { metaDescription } from '@/lib/seo/meta'

// Round H (H5): a canonical address and a plain-text search description.
export const metadata: Metadata = {
  title: 'About',
  description: metaDescription('Sea N Shore connects seafarers, shore professionals, recruiters, trainers, students, families and maritime organizations through trusted profiles, jobs, learning and events.'),
  alternates: { canonical: '/about' },
}
// Round H (H7): the sections the owner fills in Admin › Site settings, and live member numbers.
export const dynamic = 'force-dynamic'

/**
 * Round H (H7): founders, team, partner logos and member numbers come from Admin › Site settings. A
 * section with no content is left out, so nothing on this page is ever made up.
 */
export default async function AboutPage() {
  const content = await getAboutPageContent()
  const [numbers, imageUrls] = await Promise.all([
    getMemberNumbers(content.memberNumbers),
    signedAboutImageUrls(content),
  ])

  return (
    <section className="mx-auto max-w-page-narrow rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8 max-md:p-5">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">About Sea N Shore</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy-950 max-md:text-2xl">A trusted professional home for the global maritime community.</h1>
      <p className="mt-4 text-sm leading-7 text-muted max-md:text-base">Sea N Shore connects seafarers, shore professionals, recruiters, trainers, students, families, maritime enthusiasts and organizations through trusted profiles, opportunities, learning, events and community conversations.</p>
      <p className="mt-3 text-sm leading-7 text-muted max-md:text-base">The platform is designed to make maritime careers more transparent and useful: fewer unnecessary middle layers, stronger professional identity, and clearer access to people, jobs and knowledge.</p>
      <AboutNumbersSection numbers={numbers} />
      <AboutPeopleSection id="about-founders" title="Founders" people={content.founders} imageUrls={imageUrls} />
      <AboutPeopleSection id="about-team" title="Team" people={content.team} imageUrls={imageUrls} />
      <AboutPartnersSection partners={content.partners} imageUrls={imageUrls} />
    </section>
  )
}
