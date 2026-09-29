import { Reveal } from '@/components/marketing/motion'
import { HIRING_COMPANIES, type LandingLogo } from './logos'

export function LogoImage({ logo, decorative = false }: { logo: LandingLogo; decorative?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small partner logos at their intrinsic size (some are SVG)
    <img
      src={logo.file}
      alt={decorative ? '' : logo.name}
      width={logo.width}
      height={logo.height}
      loading="lazy"
      decoding="async"
      className={logo.small ? 'sm' : undefined}
    />
  )
}

/**
 * A logo that opens the company's official website in a new tab when one is verified
 * (`logo.href`); otherwise the plain image. `decorative` copies (marquee duplicates,
 * tiles that already show the name) keep the image unlabelled but the link keeps its
 * accessible name.
 */
export function LogoLink({ logo, decorative = false, tabIndex }: { logo: LandingLogo; decorative?: boolean; tabIndex?: number }) {
  const image = <LogoImage logo={logo} decorative={decorative || Boolean(logo.href)} />
  if (!logo.href) return image
  return (
    <a
      href={logo.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Visit ${logo.name} website`}
      title={`Visit ${logo.name} website`}
      className="logo-link"
      tabIndex={tabIndex}
    >
      {image}
    </a>
  )
}

/** "Maritime companies hiring on Sea N Shore" — an endless, pausable logo marquee. */
export function HiringMarquee() {
  return (
    <section className="hiring" aria-labelledby="hiring-title">
      <div className="wrap">
        <Reveal className="label">
          <p id="hiring-title">Maritime companies hiring on Sea N Shore</p>
          <a href="#partners" style={{ fontWeight: 800, color: 'var(--teal-d)', fontSize: 15 }}>See all partners →</a>
        </Reveal>
      </div>
      <div className="marquee">
        <ul className="track" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {HIRING_COMPANIES.map((logo) => (
            <li key={logo.file} className="logo-tile"><LogoLink logo={logo} /></li>
          ))}
          {HIRING_COMPANIES.map((logo) => (
            <li key={`${logo.file}-dup`} className="logo-tile dup" aria-hidden="true"><LogoImage logo={logo} decorative /></li>
          ))}
        </ul>
      </div>
    </section>
  )
}
