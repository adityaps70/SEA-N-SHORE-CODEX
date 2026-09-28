import Image from 'next/image'
import Link from 'next/link'
import { BRAND_ASSETS, BRAND_NAME } from '@/components/brand/brand-assets'
import { FaqAccordion } from '@/components/marketing/faq/faq-accordion'
import type { FaqItem } from '@/components/marketing/faq/faq-data'
import { Reveal } from '@/components/marketing/motion'
import { configuredSocialLinks } from '@/components/navigation/social-links'
import { BUSINESS, businessAddressLine, telHref } from '@/config/business'
import { formatRupeesShort } from '@/features/billing/plans'
import { LANDING_LINKS, LANDING_SECTIONS } from './landing-links'
import { LogoImage } from './landing-logos'
import { GLOBAL_PARTNERS, HIRING_COMPANIES, MORE_HIRING_PARTNERS, PARENT_GROUP_LOGO, PARTNERS } from './logos'

export function PartnersSection() {
  const hiring = [...HIRING_COMPANIES, ...MORE_HIRING_PARTNERS]
  return (
    <section className="block" id="partners" aria-labelledby="partners-title">
      <div className="wrap">
        <Reveal className="head">
          <div>
            <span className="eyebrow">Our partners</span>
            <h2 id="partners-title">Backed by people who already run ships and crews.</h2>
          </div>
          <p>Sea N Shore is part of the Beaufort Marine group and works with partners across crewing, training, travel, wellness and finance.</p>
        </Reveal>
        <div className="parent">
          <Reveal className="pcard" delay={0}>
            <span className="eyebrow">Parent group</span>
            <LogoImage logo={PARENT_GROUP_LOGO} />
          </Reveal>
          <Reveal className="note" delay={1}>
            <strong style={{ fontFamily: 'var(--display)', fontSize: 24, lineHeight: 1.15 }}>Run by maritime people, for maritime people.</strong>
            <p>Beaufort Marine Services LLP, Navi Mumbai, operates Sea N Shore and hires through it for its own vessels and clients.</p>
          </Reveal>
        </div>

        <h3 className="subhead">Partners</h3>
        <ul className="pgrid flex" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {PARTNERS.map((partner, index) => (
            <Reveal as="li" key={partner.file} className="ptile" delay={index}>
              <div className="lg"><LogoImage logo={partner} /></div>
              <span>{partner.role}</span>
            </Reveal>
          ))}
        </ul>

        <h3 className="subhead">Global partners</h3>
        <ul className="pgrid g4" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {GLOBAL_PARTNERS.map((partner, index) => (
            <Reveal as="li" key={partner.file} className="ptile" delay={index}>
              <div className="lg"><LogoImage logo={partner} /></div>
              <span>Global partner</span>
            </Reveal>
          ))}
        </ul>

        <h3 className="subhead">Companies hiring</h3>
        <ul className="pgrid" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {hiring.map((company, index) => (
            <Reveal as="li" key={company.file} className="ptile" delay={index}>
              <div className="lg"><LogoImage logo={company} decorative /></div>
              <span>{company.name}</span>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  )
}

export type LandingPlanPrices = {
  creator: { month: number | null; year: number | null }
  organization: { month: number | null; year: number | null }
}

function PlanAmount({ month, year }: { month: number | null; year: number | null }) {
  if (month === null && year === null) {
    return (
      <>
        <div className="amt" style={{ fontSize: 26 }}>See pricing</div>
        <p>The exact price is shown before you pay.</p>
      </>
    )
  }
  return (
    <>
      <div className="amt">
        {month !== null ? <>{formatRupeesShort(month)}<small> / month</small></> : <>{formatRupeesShort(year as number)}<small> / year</small></>}
      </div>
      <p>{month !== null && year !== null ? `or ${formatRupeesShort(year)} a year` : 'Renews automatically'}</p>
    </>
  )
}

export function PricingSection({ prices }: { prices: LandingPlanPrices }) {
  return (
    <section className="block aud" id="pricing" aria-labelledby="pricing-title">
      <div className="wrap">
        <Reveal className="head">
          <div>
            <span className="eyebrow">Pricing</span>
            <h2 id="pricing-title">Free to join. Pay only when you publish or hire.</h2>
          </div>
          <p>Every member is free. Creators and organizations upgrade when they want to sell, hire or grow.</p>
        </Reveal>
        <div className="prices">
          <Reveal as="article" className="price" delay={0}>
            <span className="eyebrow">Member</span>
            <div className="amt">Free</div>
            <p>For every seafarer and shore professional.</p>
            <ul>
              <li>Maritime Passport &amp; DG profile PDF</li>
              <li>Jobs with Maritime Match</li>
              <li>Feed, messages, courses &amp; events</li>
            </ul>
          </Reveal>
          <Reveal as="article" className="price pop" delay={1}>
            <span className="eyebrow">Creator Pro</span>
            <PlanAmount {...prices.creator} />
            <ul>
              <li>Publish courses and events</li>
              <li>Sell tickets &amp; courses</li>
              <li>Payouts to your bank</li>
            </ul>
          </Reveal>
          <Reveal as="article" className="price" delay={2}>
            <span className="eyebrow">Organization Pro</span>
            <PlanAmount {...prices.organization} />
            <ul>
              <li>Post jobs &amp; review applicants</li>
              <li>Team roles &amp; organization posts</li>
              <li>Page analytics</li>
            </ul>
          </Reveal>
        </div>
        <p className="price-note">
          Prices in Indian rupees. Paid plans renew automatically; cancel auto-renew any time.{' '}
          <Link href={LANDING_LINKS.pricing}>Compare plans</Link>
        </p>
      </div>
    </section>
  )
}

export function FaqSection({ items }: { items: FaqItem[] }) {
  return (
    <section className="block faqsec" id="faq" aria-labelledby="faq-title">
      <div className="wrap faq-grid">
        <Reveal className="faq-intro">
          <span className="eyebrow">Questions</span>
          <h2 id="faq-title">Frequently asked questions</h2>
          <p>Short answers about membership, jobs, company pages, plans and your account.</p>
          <Link className="flink" href="/help#faq">See all questions</Link>
        </Reveal>
        <Reveal>
          <FaqAccordion items={items} idPrefix="landing-faq" />
        </Reveal>
      </div>
    </section>
  )
}

export function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="final" id="join" aria-labelledby="join-title">
      <div className="bg">
        <Image src="/landing/ph_sunset.webp" alt="" width={1600} height={1069} sizes="100vw" />
      </div>
      <div className="wrap">
        <div className="inner">
          <Reveal delay={0} style={{ alignSelf: 'flex-start' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- brand artwork at its intrinsic size */}
            <img src={BRAND_ASSETS.markWhite.src} width={BRAND_ASSETS.markWhite.width} height={BRAND_ASSETS.markWhite.height} alt="" loading="lazy" decoding="async" style={{ height: 92, width: 'auto', opacity: 0.95 }} />
          </Reveal>
          <Reveal as="h2" id="join-title" delay={1}>Your next contract, course or crew starts here.</Reveal>
          <Reveal as="p" delay={2}>Free for every seafarer and shore professional. No card needed.</Reveal>
          <Reveal delay={3} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
            {signedIn ? (
              <Link className="btn btn-teal" href={LANDING_LINKS.home}>Go to Home</Link>
            ) : (
              <Link className="btn btn-teal" href={LANDING_LINKS.signUp}>Join Sea N Shore free</Link>
            )}
            <Link className="btn btn-ghost-light" href={LANDING_LINKS.registerOrganization}>Create an organization page</Link>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function socialHandle(href: string) {
  try {
    const path = new URL(href).pathname.replace(/^\/+|\/+$/g, '')
    return path ? (href.includes('instagram.com') ? path : `@${path}`) : ''
  } catch {
    return ''
  }
}

const COMPANY_LINKS = [
  { href: '#organizations', label: 'For companies' },
  { href: '#partners', label: 'Partners' },
  { href: '#faq', label: 'FAQ' },
  { href: '/about', label: 'About' },
  { href: '/help', label: 'Help' },
  { href: '/contact', label: 'Contact us' },
  { href: '/newsletter', label: 'Newsletter' },
]

const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refunds', label: 'Refunds & cancellation' },
  { href: '/shipping', label: 'Shipping & delivery' },
  { href: '/copyright', label: 'Copyright & IP' },
  { href: '/accessibility', label: 'Accessibility' },
]

const PLATFORM_LINKS = [
  ...LANDING_SECTIONS.filter((section) => section.id !== 'organizations' && section.id !== 'pricing').map((section) => ({
    href: `#${section.id}`,
    label: section.id === 'passport' ? 'Maritime Passport' : section.label,
  })),
  { href: '/pricing', label: 'Pricing' },
]

function FooterLink({ href, label }: { href: string; label: string }) {
  return <li>{href.startsWith('#') ? <a href={href}>{label}</a> : <Link href={href}>{label}</Link>}</li>
}

export function LandingFooter() {
  const social = configuredSocialLinks()
  const year = new Date().getFullYear()
  return (
    <footer aria-label="Site footer">
      <div className="wrap cols">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- brand artwork at its intrinsic size */}
          <img src={BRAND_ASSETS.lockupWhite.src} width={BRAND_ASSETS.lockupWhite.width} height={BRAND_ASSETS.lockupWhite.height} alt={BRAND_NAME} loading="lazy" decoding="async" />
          <p>The professional network for seafarers and shore professionals. Operated by {BUSINESS.legalName}, {businessAddressLine()}.</p>
          <p>
            <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> · <a className="nowrap" href={telHref(BUSINESS.phone.tel)}>{BUSINESS.phone.display}</a>
          </p>
        </div>
        <nav aria-label="Platform">
          <h4>Platform</h4>
          <ul>{PLATFORM_LINKS.map((link) => <FooterLink key={link.href} {...link} />)}</ul>
        </nav>
        <nav aria-label="Company">
          <h4>Company</h4>
          <ul>{COMPANY_LINKS.map((link) => <FooterLink key={link.href} {...link} />)}</ul>
        </nav>
        <nav aria-label="Legal">
          <h4>Legal</h4>
          <ul>{LEGAL_LINKS.map((link) => <FooterLink key={link.href} {...link} />)}</ul>
        </nav>
        {social.length ? (
          <div>
            <h4>Follow</h4>
            <ul aria-label="Sea N Shore on social media">
              {social.map((link) => {
                const handle = socialHandle(link.href)
                return (
                  <li key={link.key}>
                    <a href={link.href} target="_blank" rel="noopener noreferrer">
                      {link.label}{handle ? ` · ${handle}` : ''}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="wrap legal">
        <span>© {year} {BUSINESS.legalName}. All rights reserved.</span>
        <span>Photos: Unsplash — Alim, NOAA, Yoanna Yordanova, Navy Medicine, Dmitrijs Safrans, Wolfgang Weiser, Shaah Shahidh, Josh Hild. Partner logos belong to their owners. User-generated content remains owned by its creators.</span>
      </div>
    </footer>
  )
}
