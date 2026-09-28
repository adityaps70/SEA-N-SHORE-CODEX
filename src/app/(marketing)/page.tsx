import type { Metadata } from 'next'
import { BRAND_ASSETS, BRAND_ICONS } from '@/components/brand/brand-assets'
import { faqJsonLd, jsonLdScript, landingFaqs } from '@/components/marketing/faq/faq-data'
import { LandingPage } from '@/components/marketing/landing/landing-page'
import { configuredSocialLinks } from '@/components/navigation/social-links'
import { BUSINESS } from '@/config/business'
import { getVerifiedUser } from '@/features/auth/queries'
import { summarizePlanPrices } from '@/features/billing/components/plan-cards'
import { loadPublicPlanPrices } from '@/features/billing/public-prices'
import { getCognitoEnvironment } from '@/lib/env'

const DESCRIPTION =
  'Sea N Shore is the professional network for seafarers and shore professionals: Maritime Passport, jobs with Maritime Match, courses, events and verified company pages.'

export const metadata: Metadata = {
  title: { absolute: 'Sea N Shore — the maritime professional network' },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Sea N Shore — the maritime professional network',
    description: DESCRIPTION,
    url: '/',
    siteName: 'Sea N Shore',
    type: 'website',
    images: [{ url: BRAND_ICONS.ogImage, width: 1200, height: 630, alt: 'Sea N Shore' }],
  },
}

// Prices come from the database and the header depends on the visitor's session.
export const dynamic = 'force-dynamic'

async function resolveViewer() {
  // Fail open: when auth/profile resolution is unavailable the page still renders for
  // an anonymous visitor (see scripts/aws/marketing-home-resilience.test.mjs).
  let viewer: Awaited<ReturnType<typeof getVerifiedUser>> | null = null
  try {
    viewer = await getVerifiedUser()
  } catch {
    viewer = null
  }
  return viewer
}

/** Same rule as /auth/sign-in: Google is offered only when Cognito has it switched on. */
function isGoogleSignInEnabled() {
  try {
    return getCognitoEnvironment().AWS_COGNITO_GOOGLE_ENABLED
  } catch {
    return false
  }
}

function organizationJsonLd() {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BUSINESS.brandName,
    legalName: BUSINESS.legalName,
    email: BUSINESS.email,
    telephone: BUSINESS.phone.tel,
    ...(site ? { url: site, logo: `${site}${BRAND_ASSETS.stacked.src}` } : {}),
    sameAs: configuredSocialLinks().map((link) => link.href),
  }
}

export default async function Home() {
  const [viewer, { prices }] = await Promise.all([resolveViewer(), loadPublicPlanPrices()])
  const signedIn = Boolean(viewer)
  const googleEnabled = isGoogleSignInEnabled()
  const faqs = landingFaqs({ googleEnabled })

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(organizationJsonLd()) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd(faqs)) }} />
      <LandingPage
        signedIn={signedIn}
        googleEnabled={googleEnabled}
        faqs={faqs}
        prices={{
          creator: summarizePlanPrices(prices, 'creator_pro'),
          organization: summarizePlanPrices(prices, 'organization_pro'),
        }}
      />
    </>
  )
}
