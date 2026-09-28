import Link from 'next/link'
import { BRAND_ASSETS, BRAND_NAME } from '@/components/brand/brand-assets'
import { ScrollHeader } from '@/components/marketing/motion'
import { LANDING_LINKS, LANDING_SECTIONS } from './landing-links'

export function LandingHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <ScrollHeader className="site">
      <div className="wrap nav">
        <a href="#top" aria-label="Sea N Shore home">
          {/* eslint-disable-next-line @next/next/no-img-element -- brand artwork at its intrinsic size, above the fold */}
          <img src={BRAND_ASSETS.lockup.src} alt={BRAND_NAME} width={BRAND_ASSETS.lockup.width} height={BRAND_ASSETS.lockup.height} fetchPriority="high" />
        </a>
        <nav aria-label="Main">
          {LANDING_SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`}>{section.label}</a>
          ))}
        </nav>
        <div className="actions">
          {signedIn ? (
            <>
              <Link className="btn btn-ghost" href={LANDING_LINKS.profile}>My Profile</Link>
              <Link className="btn btn-dark" href={LANDING_LINKS.home}>Home</Link>
            </>
          ) : (
            <>
              <Link className="btn btn-ghost" href={LANDING_LINKS.signIn}>Sign in</Link>
              <Link className="btn btn-dark" href={LANDING_LINKS.signUp}>Join now</Link>
            </>
          )}
        </div>
      </div>
      <nav className="subnav" aria-label="Sections">
        {LANDING_SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`}>{section.label}</a>
        ))}
      </nav>
    </ScrollHeader>
  )
}
