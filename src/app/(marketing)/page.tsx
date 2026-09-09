import { CommunityProofStrip } from '@/components/marketing/community-proof-strip'
import { EcosystemCapabilities } from '@/components/marketing/ecosystem-capabilities'
import { EcosystemJourney } from '@/components/marketing/ecosystem-journey'
import { FinalEcosystemCta } from '@/components/marketing/final-ecosystem-cta'
import { MaritimeAudiences } from '@/components/marketing/maritime-audiences'
import { MaritimeEcosystemHero } from '@/components/marketing/maritime-ecosystem-hero'
import { MaritimeFeedShowcase } from '@/components/marketing/maritime-feed-showcase'
import { MaritimePassportShowcase } from '@/components/marketing/maritime-passport-showcase'
import { OpportunitiesShowcase } from '@/components/marketing/opportunities-showcase'
import { ProfessionalDiscoveryShowcase } from '@/components/marketing/professional-discovery-showcase'
import { WhySeaNShore } from '@/components/marketing/why-sea-n-shore'
import { getPublicVisitorActions } from '@/components/navigation/public-visitor-actions'
import { getVerifiedUser } from '@/features/auth/queries'

export default async function Home() {
  const viewer = await getVerifiedUser()
  const actions = getPublicVisitorActions(Boolean(viewer))

  return (
    <main id="main-content">
      <MaritimeEcosystemHero primary={actions.heroPrimary} secondary={actions.heroSecondary} />
      <CommunityProofStrip />
      <EcosystemCapabilities />
      <MaritimePassportShowcase />
      <MaritimeAudiences />
      <MaritimeFeedShowcase />
      <ProfessionalDiscoveryShowcase />
      <OpportunitiesShowcase />
      <WhySeaNShore />
      <EcosystemJourney />
      <FinalEcosystemCta primary={actions.heroPrimary} secondary={actions.heroSecondary} />
    </main>
  )
}
