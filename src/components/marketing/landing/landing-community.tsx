import Image from 'next/image'
import Link from 'next/link'
import { Reveal } from '@/components/marketing/motion'
import { FeedPostPreview, OrganizationPagePreview } from './app-cards'
import { LANDING_LINKS } from './landing-links'

const FEED_POINTS = [
  { title: 'Post as yourself or as your organization.', body: 'Owners, administrators and content managers can post with the company’s name and logo.' },
  { title: 'React, comment, repost and send.', body: 'Several reaction types, replies and sharing by message.' },
  { title: 'Follow people and companies.', body: 'Organization posts also appear on their page’s Posts tab.' },
  { title: 'Message people directly.', body: 'Talk to recruiters, crew and organizations one-to-one.' },
  { title: 'Save what matters.', body: 'Keep posts in your Saved grid to read later.' },
]

export function FeedSection() {
  return (
    <section className="block feedsec" id="feed" aria-labelledby="feed-title">
      <div className="wrap feed-grid">
        <div className="feed-copy">
          <span className="fnum">05 · Feed &amp; messages</span>
          <h2 id="feed-title">Where the industry talks shop.</h2>
          <p>Seafarers, shore staff and verified organizations all post to one maritime feed. Share a lesson from your last contract, a hiring update, an event or a new course — and see what the people you follow are talking about.</p>
          <ul className="ticks">
            {FEED_POINTS.map((point, index) => (
              <Reveal as="li" key={point.title} delay={index}>
                <b>{point.title}</b> {point.body}
              </Reveal>
            ))}
          </ul>
          <a className="btn btn-dark" href="#join">Join the conversation</a>
        </div>

        <Reveal className="feed-mock real">
          <FeedPostPreview />
          <span className="ex" style={{ textAlign: 'center' }}>A real post from the Sea N Shore feed</span>
        </Reveal>
      </div>
    </section>
  )
}

const AUDIENCES = [
  {
    title: 'Seafarers',
    image: { src: '/landing/ph_bridge.webp', alt: 'Officer at the controls on a ship’s bridge', width: 800, height: 531 },
    points: ['Maritime Passport & DG profile PDF', 'Jobs scored by Maritime Match', 'Certificates on your profile'],
    link: { href: LANDING_LINKS.signUp, label: 'Start as a seafarer →' },
  },
  {
    title: 'Shore professionals',
    image: { src: '/landing/ph_tanker.webp', alt: 'Aerial view of a tanker at sea', width: 800, height: 600 },
    points: ['Superintendent, ops, surveying roles', 'Grow a following with posts', 'Creator Pro to publish courses'],
    link: { href: LANDING_LINKS.signUp, label: 'Start ashore →' },
  },
  {
    title: 'Recruiters & crewing',
    image: { src: '/landing/ph_crew.webp', alt: 'Three crew members on deck looking out to sea', width: 800, height: 532 },
    points: ['Verified company page with team roles', 'Post jobs, review applicants', 'Post as your organization'],
    link: { href: '#organizations', label: 'Create your company page →' },
  },
  {
    title: 'Institutes & organizers',
    image: { src: '/landing/ph_training.webp', alt: 'Trainees in life jackets and hard hats handling rope', width: 800, height: 534 },
    points: ['Sell courses and event tickets', 'UPI & card checkout built in', 'Earnings paid out to your bank'],
    link: { href: '#organizations', label: 'Create your institute page →' },
  },
]

const STEPS = [
  { title: 'Sign up free', body: 'Email or phone. Takes under a minute.' },
  { title: 'Build your Passport', body: 'Rank, sea service, vessels, certificates.' },
  { title: 'Get matched', body: 'See your Maritime Match on every job.' },
]

export function AudiencesSection() {
  return (
    <section className="block aud" id="who" aria-labelledby="who-title">
      <div className="wrap">
        <Reveal className="head">
          <div>
            <span className="eyebrow">One community, every side of shipping</span>
            <h2 id="who-title">Whether you’re on the bridge or behind the desk.</h2>
          </div>
        </Reveal>
        <div className="aud-grid swipe">
          {AUDIENCES.map((audience, index) => (
            <Reveal as="article" key={audience.title} className="who" delay={index}>
              <div className="ph">
                <Image src={audience.image.src} alt={audience.image.alt} width={audience.image.width} height={audience.image.height} sizes="(max-width: 720px) 100vw, (max-width: 1100px) 50vw, 300px" />
              </div>
              <div className="body">
                <h3>{audience.title}</h3>
                <ul>
                  {audience.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
                {audience.link.href.startsWith('#') ? (
                  <a href={audience.link.href}>{audience.link.label}</a>
                ) : (
                  <Link href={audience.link.href}>{audience.link.label}</Link>
                )}
              </div>
            </Reveal>
          ))}
        </div>
        <div className="steps">
          <Reveal delay={0}>
            <span className="eyebrow" style={{ color: '#6FE3D2' }}>Join in 3 steps</span>
            <h3>Ready before your next port call.</h3>
          </Reveal>
          {STEPS.map((step, index) => (
            <Reveal key={step.title} className="step" delay={index + 1}>
              <b>{String(index + 1).padStart(2, '0')}</b>
              <strong>{step.title}</strong>
              <span>{step.body}</span>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

const ORG_STEPS = [
  { title: 'Register your organization', body: 'Name, type, website and business details. Takes a few minutes and it’s free.' },
  { title: 'We verify it', body: 'Every organization is reviewed before its page goes live, so members only see real employers.' },
  { title: 'Add your team', body: 'Invite colleagues, give them roles such as administrator or content manager, and approve people who ask to join.' },
  { title: 'Start publishing', body: 'Post as your organization, list jobs, run events and sell courses. Organization Pro unlocks the full hiring toolkit.' },
]

export function OrganizationsSection() {
  return (
    <section className="block orgsec" id="organizations" aria-labelledby="organizations-title">
      <div className="wrap">
        <Reveal className="head">
          <div>
            <span className="fnum" style={{ background: 'rgba(25,195,177,.16)', color: '#6FE3D2' }}>06 · Company pages</span>
            <h2 id="organizations-title" style={{ color: '#fff' }}>Create your organization’s page. Hire, post and teach from it.</h2>
          </div>
          <p style={{ color: '#CFE0E8' }}>Ship managers, crewing agencies, training institutes and event organizers get a verified page on Sea N Shore — with jobs, posts, events, courses and a team behind it.</p>
        </Reveal>
        <div className="org-grid">
          <ol className="org-steps">
            {ORG_STEPS.map((step, index) => (
              <Reveal as="li" key={step.title} delay={index}>
                <b aria-hidden="true">{index + 1}</b>
                <div><strong>{step.title}</strong><span>{step.body}</span></div>
              </Reveal>
            ))}
            <Reveal as="li" className="org-cta" delay={ORG_STEPS.length}>
              <Link className="btn btn-teal" href={LANDING_LINKS.registerOrganization}>Create your organization page</Link>
              <Link className="btn btn-ghost-light" href={LANDING_LINKS.pricing}>See Organization Pro</Link>
            </Reveal>
          </ol>

          <Reveal>
            <OrganizationPagePreview />
          </Reveal>
        </div>
      </div>
    </section>
  )
}
