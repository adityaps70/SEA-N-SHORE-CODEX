import Image from 'next/image'
import {
  Award,
  BadgeCheck,
  BookOpen,
  Bookmark,
  Building2,
  CalendarClock,
  CalendarDays,
  CircleCheck,
  Ellipsis,
  ExternalLink,
  FileText,
  MapPin,
  MessageCircle,
  MessageCircleMore,
  Plus,
  Repeat2,
  Send,
  Ship,
  TriangleAlert,
  Users,
  WalletCards,
  ArrowRight,
} from 'lucide-react'
import { BRAND_ASSETS } from '@/components/brand/brand-assets'

/*
 * Static look-alikes of real Sea N Shore app cards (job, profile, course, event, post,
 * organization page), drawn with the app's own tokens (.sns in landing.css). They are
 * pictures of the product, not interactive UI, so buttons are plain spans.
 */

export function JobCardPreview({ summary = true, className = '' }: { summary?: boolean; className?: string }) {
  return (
    <article className={`sns scard job ${className}`.trim()} aria-label="Example job: Chief Officer — Offshore (AHTS)">
      <div className="jtop">
        <div className="jlogo" aria-hidden="true">SS</div>
        <div style={{ minWidth: 0 }}>
          <div className="jco"><b>Star Sea Management</b><span className="chipu">Urgent</span></div>
          <span className="jt">Chief Officer — Offshore (AHTS)</span>
          <div className="jloc">Employer based in United Arab Emirates</div>
        </div>
      </div>
      <div className="jmeta">
        <span><Ship size={14} aria-hidden="true" />AHTS</span>
        <span><MapPin size={14} aria-hidden="true" />United Arab Emirates</span>
        <span><WalletCards size={14} aria-hidden="true" />Negotiable</span>
        <span><CalendarClock size={14} aria-hidden="true" />Immediate joining</span>
      </div>
      <div className="jchips"><span>Chief Officer</span><span>Offshore</span></div>
      {summary ? (
        <p className="jsum">Minimum 2 years of offshore vessel experience, at least 6 months on AHTS, National Master CoC – Unlimited/Limitations.</p>
      ) : null}
      <div className="jm">
        <div className="r"><b>Your match</b><span>82%</span></div>
        <div className="bar"><i style={{ width: '82%' }} /></div>
        <p>Your rank and offshore sea service match this role.</p>
      </div>
      <div className="jf" style={summary ? undefined : { paddingTop: 14 }}>
        <span className="btn-p"><Send size={16} aria-hidden="true" />Easy Apply</span>
        <span className="btn-s"><Bookmark size={16} aria-hidden="true" />Save</span>
      </div>
    </article>
  )
}

export function MatchPanelPreview() {
  return (
    <div className="sns scard mpanel">
      <div className="mh">
        <div><span>Sea N Shore intelligence</span><strong>Your Maritime Match</strong></div>
        <div className="ms"><b>82%</b><span>profile fit</span></div>
      </div>
      <div className="mb">
        <div>
          <h5>What matches</h5>
          <p><CircleCheck size={16} aria-hidden="true" />Chief Officer rank</p>
          <p><CircleCheck size={16} aria-hidden="true" />Offshore vessel experience</p>
          <p><CircleCheck size={16} aria-hidden="true" />Available for immediate joining</p>
        </div>
        <div>
          <h5>Check before applying</h5>
          <p className="w"><TriangleAlert size={16} aria-hidden="true" />6 months on AHTS required</p>
          <p className="w"><TriangleAlert size={16} aria-hidden="true" />National Master CoC</p>
        </div>
      </div>
    </div>
  )
}

export function ProfileCardPreview() {
  return (
    <article className="sns scard prof" aria-label="Sea N Shore profile of Prakhar Pathak">
      <div className="pcov">
        <Image src="/landing/real_pp_cover.webp" alt="" width={700} height={525} sizes="280px" style={{ objectPosition: '50% 60%' }} />
      </div>
      <div className="pbd">
        <div className="pphoto">
          <Image src="/landing/real_pp_face.webp" alt="Prakhar Pathak" width={300} height={300} sizes="80px" />
        </div>
        <div className="pname">Prakhar Pathak</div>
        <div className="phl">Marine Engineer turned Entrepreneur</div>
        <div className="ppersona">Seafarer</div>
        <div className="ploc"><MapPin size={14} aria-hidden="true" />Lucknow</div>
      </div>
      <div className="porg">
        <span className="lg" style={{ color: 'var(--ocean-700)' }}><Building2 size={16} aria-hidden="true" /></span>
        Beaufort It Solutions PVT LTD
      </div>
    </article>
  )
}

export function PassportChips() {
  return (
    <>
      <div className="sns scard pdfchip">
        <span className="pdfic" aria-hidden="true">PDF</span>
        <div><b>Profile — DG format</b><span>Ready to send to any crewing office</span></div>
        <FileText size={18} aria-hidden="true" />
      </div>
      <div className="sns scard certchip">
        <span className="ci"><Award size={18} aria-hidden="true" /></span>
        <div><b>Certificate added</b><span>SIRE 2.0 Inspection Readiness</span></div>
      </div>
    </>
  )
}

export function CourseCardPreview() {
  return (
    <article className="sns scard course" aria-label="Course: SIRE 2.0 Inspection Readiness">
      <div className="ccov">
        <Image src="/landing/real_sire_cover.webp" alt="SIRE 2.0 Inspection Readiness course cover" width={960} height={540} sizes="(max-width: 720px) 100vw, 440px" />
        <span className="tl"><BookOpen size={14} aria-hidden="true" />SIRE 2.0</span>
        <span className="tr">Free</span>
      </div>
      <div className="cbd">
        <div className="cchips">
          <span>All levels</span><span>Recorded</span><span>English</span>
          <span className="cert"><Award size={14} aria-hidden="true" />Certificate</span>
        </div>
        <div className="ctitle">SIRE 2.0 Inspection Readiness: The Complete Practitioner Course</div>
        <p className="cdesc">Master the OCIMF SIRE 2.0 regime end to end — CVIQ structure, Human, Process and Hardware factors, inspection-day performance and observation close-out.</p>
        <div className="ctr">
          <span className="a" aria-hidden="true">A</span>
          <div><b>Aditya pratap singh</b><span><CircleCheck size={14} aria-hidden="true" />Verified trainer</span></div>
        </div>
      </div>
    </article>
  )
}

export function EventCardPreview() {
  return (
    <article className="sns scard ev" aria-label="Example event: SIRE 2.0 inspection readiness workshop">
      <div className="evb">
        <Image src="/landing/ph_port.webp" alt="" width={900} height={507} sizes="(max-width: 720px) 100vw, 440px" />
      </div>
      <div className="evbody">
        <div className="evchips"><span className="c1">Hybrid</span><span className="c2">₹499</span><span className="c3">Training</span><span className="c4">Workshop</span></div>
        <div>
          <div className="evt">SIRE 2.0 inspection readiness workshop</div>
          <p className="evs">A hands-on session on CVIQ, the Human, Process and Hardware factors, and closing out observations.</p>
        </div>
        <div className="evf">
          <span><CalendarDays size={16} aria-hidden="true" />Sat, 5 pm IST</span>
          <span><MapPin size={16} aria-hidden="true" />Navi Mumbai &amp; online</span>
          <span><Users size={16} aria-hidden="true" />Limited seats</span>
        </div>
        <div className="evh">Hosted by <b>BEAUFORT MARINE SERVICES LLP</b></div>
        <div className="evc">View event <ArrowRight size={16} aria-hidden="true" /></div>
      </div>
    </article>
  )
}

export function FeedPostPreview() {
  return (
    <article className="sns scard spost" aria-label="Post by Rinki Mukharjee">
      <div className="ph">
        <div className="av"><Image src="/landing/real_rinki_avatar.webp" alt="Rinki Mukharjee" width={226} height={380} sizes="44px" /></div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="pn">Rinki Mukharjee</div>
          <div className="psub">Community Relationship Manager · BEAUFORT MARINE SERVICES LLP</div>
          <span className="ptime">3d ago</span>
        </div>
        <span className="pmenu" aria-hidden="true"><Ellipsis size={20} /></span>
      </div>
      <div className="pbody">
        <p className="ptext">Celebrating World Maritime Day.</p>
        <div className="pmedia">
          <Image src="/landing/real_wmd_post.webp" alt="Sea N Shore World Maritime Day graphic, 25 September" width={800} height={800} sizes="(max-width: 1100px) 100vw, 560px" />
        </div>
      </div>
      <div className="prow">
        <div className="pl">
          <span className="pill on"><span className="em" aria-hidden="true">👍</span>4<span className="sr-only"> reactions</span></span>
          <span className="pill"><MessageCircle size={20} aria-hidden="true" />1<span className="sr-only"> comment</span></span>
          <span className="pill" aria-hidden="true"><Repeat2 size={20} /></span>
          <span className="pill" aria-hidden="true"><Send size={20} /></span>
        </div>
        <span className="rsum" aria-hidden="true"><i>👍</i></span>
      </div>
      <div className="cmts">
        <div className="cav"><Image src="/landing/real_yusra_avatar.webp" alt="Yusra Madre" width={300} height={672} sizes="40px" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cbub">
            <div className="top"><b>Yusra Madre</b><span>Community Relationship Manager</span><em>3d</em></div>
            <p>Happy world maritime day</p>
          </div>
          <div className="cacts" aria-hidden="true">Like · Reply</div>
        </div>
      </div>
    </article>
  )
}

export function OrganizationPagePreview() {
  return (
    <section className="sns scard org" aria-label="Beaufort Marine Services LLP organization page on Sea N Shore">
      <div className="ocov obanner">
        <Image src="/landing/ph_tanker.webp" alt="" width={800} height={600} sizes="(max-width: 1100px) 60vw, 400px" />
        <div className="bn">
          {/* eslint-disable-next-line @next/next/no-img-element -- small brand artwork at its intrinsic size */}
          <img src={BRAND_ASSETS.markWhite.src} width={BRAND_ASSETS.markWhite.width} height={BRAND_ASSETS.markWhite.height} alt="" loading="lazy" decoding="async" />
          <div>
            <strong>BEAUFORT MARINE SERVICES LLP</strong>
            <span>Vetting readiness · Bridge audits · SMS · Crew training</span>
            <em>Founded by Master Mariners · Navi Mumbai · since 2017</em>
          </div>
        </div>
      </div>
      <div className="obody">
        <div className="ologo" style={{ background: '#fff' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- small brand artwork at its intrinsic size */}
          <img
            src={BRAND_ASSETS.mark.src}
            width={BRAND_ASSETS.mark.width}
            height={BRAND_ASSETS.mark.height}
            alt="Beaufort Marine Services LLP logo"
            loading="lazy"
            decoding="async"
            style={{ width: '82%', height: '82%', objectFit: 'contain' }}
          />
        </div>
        <div className="oname">BEAUFORT MARINE SERVICES LLP <BadgeCheck size={24} aria-label="Verified" /></div>
        <p className="otag">Beaufort Marine Services LLP was started by three Master Mariners in June 2017 with the aim of preparing ships for minimum risk observations, ensuring vessels…</p>
        <div className="ometa">MARINE SERVICES · Navi Mumbai, India · 2 followers</div>
        <div className="opeople">2 people work here</div>
        <div className="sobtns" aria-hidden="true">
          <span className="btn-p" style={{ fontWeight: 700 }}>Visit website <ExternalLink size={16} /></span>
          <span className="fol"><Plus size={16} />Follow</span>
          <span className="btn-p"><MessageCircleMore size={16} />Message</span>
          <span className="dots"><Ellipsis size={20} /></span>
        </div>
        <div className="sotabs" aria-hidden="true">
          <span className="on">Home</span><span>About</span><span>Posts</span><span>Jobs</span><span>Events</span><span>Courses</span><span>People</span>
        </div>
      </div>
    </section>
  )
}
