import localFont from 'next/font/local'
import { MainLandmark } from '@/components/layout/main-landmark'
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

/*
 * The landing faces, self-hosted from ./fonts (latin subset, SIL OFL 1.1) so the page makes no request to Google and the
 * CSP needs no Google Fonts hosts. Bricolage Grotesque (variable, optical size and weight) for display headings, Figtree
 * (variable weight) for body text. landing.css reads them as --display and --body; the app's own Inter (--font-body,
 * from the root layout) covers the product mock-ups.
 */
const landingDisplayFont = localFont({
  src: './fonts/bricolage-grotesque-latin-opsz-normal.woff2',
  weight: '200 800',
  variable: '--font-landing-display',
  display: 'swap',
})
const landingBodyFont = localFont({
  src: './fonts/figtree-latin-wght-normal.woff2',
  weight: '300 900',
  variable: '--font-landing-body',
  display: 'swap',
})

/**
 * The public Sea N Shore landing page (approved design, Sept 2026).
 * Round H (H6): signed-out visitors get the landing header and footer. For members the marketing
 * layout draws the app chrome (header, phone bars, site footer) around this page, so both are left out.
 */
export function LandingPage({ signedIn, googleEnabled, prices, faqs }: LandingPageProps) {
  return (
    <MotionRoot className={`lp ${landingDisplayFont.variable} ${landingBodyFont.variable}`}>
      {/* Round H (H8): members get "Skip to content" from the app chrome, before its header. */}
      {signedIn ? null : <a className="skip" href="#main-content">Skip to content</a>}
      {/* Round H (H6): members get the fixed app header, so the landing's own header and top progress bar are left out. */}
      {signedIn ? null : <ScrollProgress />}
      {signedIn ? null : <LandingHeader />}
      <MainLandmark>
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
      </MainLandmark>
      {signedIn ? null : <LandingFooter />}
    </MotionRoot>
  )
}
