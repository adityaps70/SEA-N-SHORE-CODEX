import type { FaqItem } from '@/components/marketing/faq/faq-data'
import { MotionRoot, ScrollProgress } from '@/components/marketing/motion'
import { AudiencesSection, FeedSection, OrganizationsSection } from './landing-community'
import { FaqSection, FinalCta, LandingFooter, PartnersSection, PricingSection, type LandingPlanPrices } from './landing-closing'
import { EventsFeature, FeatureOverview, JobsFeature, LearnFeature, PassportFeature } from './landing-features'
import { LandingHeader } from './landing-header'
import { LandingHero } from './landing-hero'
import { HiringMarquee } from './landing-logos'
import './landing.css'

export type LandingPageProps = {
  signedIn: boolean
  googleEnabled: boolean
  prices: LandingPlanPrices
  faqs: FaqItem[]
}

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800;900&display=swap'

/** The public Sea N Shore landing page (approved design, Sept 2026). */
export function LandingPage({ signedIn, googleEnabled, prices, faqs }: LandingPageProps) {
  return (
    <MotionRoot className="lp">
      {/* React hoists these into <head>. Fonts fall back to system faces if blocked. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={FONTS_HREF} precedence="default" />

      <a className="skip" href="#main-content">Skip to content</a>
      <ScrollProgress />
      <LandingHeader signedIn={signedIn} />
      <main id="main-content" tabIndex={-1}>
        <div id="top" />
        <LandingHero signedIn={signedIn} googleEnabled={googleEnabled} />
        <HiringMarquee />
        <FeatureOverview />
        <JobsFeature />
        <PassportFeature />
        <LearnFeature />
        <EventsFeature />
        <FeedSection />
        <AudiencesSection />
        <OrganizationsSection />
        <PartnersSection />
        <PricingSection prices={prices} />
        <FaqSection items={faqs} />
        <FinalCta signedIn={signedIn} />
      </main>
      <LandingFooter />
    </MotionRoot>
  )
}
