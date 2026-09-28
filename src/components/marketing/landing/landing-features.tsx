import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import {
  ArrowRight,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CircleCheck,
  IdCard,
  MessagesSquare,
} from 'lucide-react'
import { Reveal } from '@/components/marketing/motion'
import {
  CourseCardPreview,
  EventCardPreview,
  JobCardPreview,
  MatchPanelPreview,
  PassportChips,
  ProfileCardPreview,
} from './app-cards'
import { LANDING_LINKS } from './landing-links'

const OVERVIEW = [
  { href: '#jobs', icon: BriefcaseBusiness, color: '#075e82', bg: '#EEF8FB', title: 'Jobs', body: 'Sea and shore roles, each with your Maritime Match score.' },
  { href: '#passport', icon: IdCard, color: '#0f766e', bg: '#F0FDFA', title: 'Maritime Passport', body: 'Your rank, sea service and certificates on one profile.' },
  { href: '#learn', icon: BookOpenCheck, color: '#115e59', bg: '#E3F4F1', title: 'Learn', body: 'Courses from verified trainers, with certificates.' },
  { href: '#events', icon: CalendarDays, color: '#92400e', bg: '#FFF4E2', title: 'Events', body: 'Webinars, workshops and meetups — free or ticketed.' },
  { href: '#feed', icon: MessagesSquare, color: '#075e82', bg: '#EEF3F7', title: 'Feed & messages', body: 'Post, react, comment and message people directly.' },
  { href: '#organizations', icon: Building2, color: '#071b2d', bg: '#EDF4F6', title: 'Company pages', body: 'Verified organizations that hire, post and teach.' },
] as const

export function FeatureOverview() {
  return (
    <section className="block ovsec" id="features" aria-labelledby="features-title">
      <div className="wrap">
        <Reveal className="head">
          <div>
            <span className="eyebrow">Built for shipping, not adapted to it</span>
            <h2 id="features-title">One free account. Everything your maritime career needs.</h2>
          </div>
          <p>Generic job sites don’t know a CoC from a CDC. Here’s what you get on Sea N Shore — tap any one to see how it works.</p>
        </Reveal>
        <div className="ov-grid">
          {OVERVIEW.map((item, index) => {
            const Icon = item.icon
            return (
              <Reveal as="a" key={item.href} className="ov" href={item.href} delay={index}>
                <span className="ovi" style={{ '--c': item.color, '--b': item.bg } as CSSProperties}>
                  <Icon size={22} aria-hidden="true" />
                </span>
                <b>{item.title}</b>
                <span>{item.body}</span>
                <em aria-hidden="true">{String(index + 1).padStart(2, '0')}</em>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function Point({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <CircleCheck size={20} aria-hidden="true" />
      <span><b>{title}</b>{children}</span>
    </li>
  )
}

function FeatureCopy({
  id,
  number,
  title,
  lead,
  points,
  link,
}: {
  id: string
  number: string
  title: string
  lead: string
  points: ReactNode
  link: { href: string; label: string }
}) {
  return (
    <div className="fcopy">
      <Reveal as="span" className="fnum" delay={0}>{number}</Reveal>
      <Reveal as="h2" id={`${id}-title`} delay={1}>{title}</Reveal>
      <Reveal as="p" delay={2}>{lead}</Reveal>
      <Reveal as="ul" className="fl2" delay={3}>{points}</Reveal>
      <Reveal delay={4}>
        <Link className="flink" href={link.href}>
          {link.label} <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </Reveal>
    </div>
  )
}

export function JobsFeature() {
  return (
    <section className="fsec" id="jobs" aria-labelledby="jobs-title">
      <div className="wrap fgrid">
        <FeatureCopy
          id="jobs"
          number="01 · Jobs"
          title="Know your fit before you apply."
          lead="Every job on Sea N Shore is scored against your Maritime Passport — rank, vessel type, sea service, certificates and availability. You see what matches and what’s missing before you hit apply."
          points={
            <>
              <Point title="Sea and shore roles"> — from Chief Officer on an AHTS to Marine Superintendent ashore.</Point>
              <Point title="Easy Apply"> with your Passport, and save jobs for later.</Point>
              <Point title="Verified employers only">, plus job alerts for your rank.</Point>
            </>
          }
          link={{ href: LANDING_LINKS.jobs, label: 'Browse jobs' }}
        />
        <Reveal className="fvis tint-ocean">
          <div className="stack">
            <JobCardPreview />
            <MatchPanelPreview />
          </div>
          <span className="ex">Real vacancy shared on Sea N Shore · example match</span>
        </Reveal>
      </div>
    </section>
  )
}

export function PassportFeature() {
  return (
    <section className="fsec alt" id="passport" aria-labelledby="passport-title">
      <div className="wrap fgrid rev">
        <FeatureCopy
          id="passport"
          number="02 · Maritime Passport"
          title="A profile recruiters read in 10 seconds."
          lead="Your Maritime Passport says what a crewing office needs to know — in their language. Keep it up to date between contracts and share it as a DG-format PDF in one tap."
          points={
            <>
              <Point title="Rank, department and availability"> front and centre.</Point>
              <Point title="Sea service by vessel type">, CoC, STCW and other certificates.</Point>
              <Point title="Course certificates"> from Sea N Shore added automatically.</Point>
            </>
          }
          link={{ href: LANDING_LINKS.signUp, label: 'Create your free Passport' }}
        />
        <Reveal className="fvis tint-teal">
          <div className="pp-stage">
            <div className="pp-card"><ProfileCardPreview /></div>
            <PassportChips />
          </div>
          <span className="ex">Real Sea N Shore profile</span>
        </Reveal>
      </div>
    </section>
  )
}

export function LearnFeature() {
  return (
    <section className="fsec" id="learn" aria-labelledby="learn-title">
      <div className="wrap fgrid">
        <FeatureCopy
          id="learn"
          number="03 · Learn"
          title="Courses with certificates you can show."
          lead="Learn from verified maritime professionals — tankers, SIRE 2.0, LNG, offshore, safety, leadership and shore careers. Finish a course and the certificate lands on your Passport."
          points={
            <>
              <Point title="Free and paid courses"> — pay by UPI or card.</Point>
              <Point title="Recorded lessons"> you can take between watches.</Point>
              <Point title="Teach your own"> with Learning Studio and Creator Pro — earnings are paid to your bank.</Point>
            </>
          }
          link={{ href: LANDING_LINKS.learn, label: 'Explore courses' }}
        />
        <Reveal className="fvis tint-mint">
          <div className="course-wrap"><CourseCardPreview /></div>
          <span className="ex">A real course on Sea N Shore</span>
        </Reveal>
      </div>
    </section>
  )
}

export function EventsFeature() {
  return (
    <section className="fsec alt" id="events" aria-labelledby="events-title">
      <div className="wrap fgrid rev">
        <FeatureCopy
          id="events"
          number="04 · Events"
          title="Webinars, workshops and port meetups."
          lead="Join sessions run by ship managers, trainers and maritime organizations — online, in person or hybrid. Register in seconds, and get a ticket for paid events."
          points={
            <>
              <Point title="Free or ticketed"> — UPI or card checkout built in.</Point>
              <Point title="Host your own"> as a person or an organization.</Point>
              <Point title="Knowledge library"> — past sessions stay discoverable.</Point>
            </>
          }
          link={{ href: LANDING_LINKS.events, label: 'See upcoming events' }}
        />
        <Reveal className="fvis tint-sand">
          <EventCardPreview />
          <span className="ex">Example event, in the real event-card design</span>
        </Reveal>
      </div>
    </section>
  )
}
