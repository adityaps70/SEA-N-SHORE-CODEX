import Image from 'next/image'
import Link from '@/components/navigation/intent-link'
import { Award, Mail, UserRoundPlus } from 'lucide-react'
import { GoogleMark } from '@/features/auth/components/google-mark'
import { Enter, Parallax, ParallaxLayer, RotatingWords, ScrollDrift } from '@/components/marketing/motion'
import { JobCardPreview, ProfileCardPreview } from './app-cards'
import { LANDING_LINKS } from './landing-links'

const AUDIENCE_WORDS = ['seafarers', 'shore staff', 'recruiters', 'trainers', 'ship managers'] as const
const HERO_TITLE_START = 'Welcome to the global community for'
const HERO_AUDIENCE = 'seafarers, shore staff, recruiters, trainers and ship managers'

function SignInOptions({ googleEnabled }: { googleEnabled: boolean }) {
  return (
    <>
      {googleEnabled ? (
        // A plain <a>: Google sign-in must not be prefetched or fetched by the app router. Its redirect to the
        // sign-in host is not allowed by the CSP's connect-src (and each prefetch set a new OAuth state cookie).
        <a className="sbtn" href={LANDING_LINKS.googleSignIn}>
          <GoogleMark />
          Continue with Google
        </a>
      ) : null}
      <Link className="sbtn primary" href={LANDING_LINKS.signIn}>
        <Mail size={20} aria-hidden="true" />
        Sign in with email
      </Link>
      <p className="terms">
        By continuing, you agree to Sea N Shore’s <Link href={LANDING_LINKS.terms}>User Agreement</Link>,{' '}
        <Link href={LANDING_LINKS.privacy}>Privacy Policy</Link> and <Link href={LANDING_LINKS.refunds}>Refund Policy</Link>.
      </p>
      <p className="joinnow">
        New to Sea N Shore? <Link href={LANDING_LINKS.signUp}>Join now — it’s free</Link>
      </p>
    </>
  )
}

function SignedInOptions() {
  return (
    <>
      <p className="signed-in">You’re signed in.</p>
      <Link className="sbtn primary" href={LANDING_LINKS.home}>Go to Home</Link>
      <Link className="sbtn" href={LANDING_LINKS.profile}>View My Profile</Link>
    </>
  )
}

export function LandingHero({ signedIn, googleEnabled }: { signedIn: boolean; googleEnabled: boolean }) {
  return (
    <section className="hero2" aria-labelledby="hero-title">
      <div className="h2bg" aria-hidden="true">
        <span className="glow g1" />
        <span className="glow g2" />
        <span className="glow g3" />
        <svg className="waves" viewBox="0 0 1440 220" preserveAspectRatio="none">
          <path className="w1" d="M0 120 C 240 80 480 160 720 120 C 960 80 1200 160 1440 120 L1440 220 L0 220 Z" />
          <path className="w2" d="M0 150 C 240 110 480 190 720 150 C 960 110 1200 190 1440 150 L1440 220 L0 220 Z" />
        </svg>
      </div>

      <div className="wrap h2grid">
        <div className="h2copy">
          <Enter as="span" className="h2pill" delay={0}>
            <span className="dot" aria-hidden="true" />
            The professional network for maritime
          </Enter>
          {/*
            Round H (H5): the h1 holds one clean sentence (search engines read its text, not the screen-reader list):
            the visible start plus the audience list, visually hidden. The rotating word sits right after the h1
            (shown inline, so it still reads "…community for seafarers") as aria-hidden decoration.
          */}
          <Enter className="h2title" delay={1}>
            <h1 id="hero-title">
              {HERO_TITLE_START}{' '}
              <span className="sr-only">{HERO_AUDIENCE}</span>
            </h1>
            <RotatingWords words={AUDIENCE_WORDS} />
          </Enter>
          <Enter as="p" className="h2lead" delay={2}>
            Build your Maritime Passport, see your fit for every job, learn from verified trainers and follow the companies that crew the world’s fleet.
          </Enter>

          <Enter className="signin" delay={3} role="group" aria-label={signedIn ? 'Continue to Sea N Shore' : 'Sign in to Sea N Shore'}>
            {signedIn ? <SignedInOptions /> : <SignInOptions googleEnabled={googleEnabled} />}
          </Enter>
        </div>

        <Parallax className="h2vis">
          <div className="ring" aria-hidden="true" />
          <Enter variant="scale" delay={1} className="h2photo">
            <ScrollDrift className="h2drift">
              <Image
                src="/landing/ph_hero.webp"
                alt="Two crew members in hard hats on the forecastle of a ship at sea"
                width={1200}
                height={1600}
                sizes="(max-width: 720px) 100vw, (max-width: 1100px) 640px, 560px"
                preload
              />
            </ScrollDrift>
          </Enter>

          <ParallaxLayer depth={18} className="fl f-prof2">
            <Enter variant="pop" delay={3}>
              <div className="bob"><ProfileCardPreview /></div>
            </Enter>
          </ParallaxLayer>
          <ParallaxLayer depth={28} className="fl f-job2">
            <Enter variant="pop" delay={4}>
              <div className="bob b2">
                <JobCardPreview summary={false} />
                <span className="ex exchip">Example match score</span>
              </div>
            </Enter>
          </ParallaxLayer>
          <ParallaxLayer depth={36} className="fl chip1">
            <Enter variant="pop" delay={5}>
              <div className="bob b3 toast">
                <span className="tic" style={{ background: '#EEF8FB', color: '#075e82' }}><UserRoundPlus size={18} aria-hidden="true" /></span>
                <span><b>Beaufort Marine Services LLP</b><em>is on Sea N Shore · Verified</em></span>
              </div>
            </Enter>
          </ParallaxLayer>
          <ParallaxLayer depth={44} className="fl chip2">
            <Enter variant="pop" delay={6}>
              <div className="bob b4 toast">
                <span className="tic" style={{ background: '#F0FDFA', color: '#0f766e' }}><Award size={18} aria-hidden="true" /></span>
                <span><b>SIRE 2.0 Inspection Readiness</b><em>Free course · Certificate</em></span>
              </div>
            </Enter>
          </ParallaxLayer>
        </Parallax>
      </div>
    </section>
  )
}
