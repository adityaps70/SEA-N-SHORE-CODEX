import type { CSSProperties, ReactNode } from 'react'
import type { CertificatePreviewSettings } from '../course-page-repository'

/**
 * Round H (H7): a scaled-down sample of the course's certificate on the course page, drawn from the course's
 * certificate settings with placeholder learner details. It follows the layouts of the issued PDF
 * (certificate-pdf.ts: classic, modern, formal, minimal) in HTML, sized in container units so it scales to any
 * width. The logo and signature images are never shown on the public page; the Sea N Shore wordmark stands in.
 */

export const SAMPLE_LEARNER_NAME = 'Your Name'
const PAGE_WIDTH = 841.89

/** PDF points to a share of the preview's width. */
function pt(value: number) {
  return `${((value / PAGE_WIDTH) * 100).toFixed(3)}cqw`
}

const NAVY = 'rgb(10 38 56)'
const OCEAN = 'rgb(10 107 140)'
const TEAL = 'rgb(13 140 133)'
const MUTED = 'rgb(89 102 112)'
const MIST = 'rgb(186 209 214)'
const GOLD = 'rgb(184 135 46)'

export type CertificatePreviewProps = {
  settings: CertificatePreviewSettings
  courseTitle: string
  mentorName: string
}

export function sampleCertificateNumber(serialPrefix: string | null) {
  return serialPrefix ? `${serialPrefix}${new Date().getUTCFullYear()}-XXXXXXXX` : 'SNS-XXXXXXXX'
}

export function sampleValidity(validityMonths: number | null) {
  if (!validityMonths) return null
  return `Valid for ${validityMonths} ${validityMonths === 1 ? 'month' : 'months'} from issue`
}

function Line({ children, size, bold = false, color = NAVY, style }: { children: ReactNode; size: number; bold?: boolean; color?: string; style?: CSSProperties }) {
  return (
    <p style={{ fontSize: pt(size), fontWeight: bold ? 700 : 400, color, lineHeight: 1.2, margin: 0, overflowWrap: 'anywhere', ...style }}>
      {children}
    </p>
  )
}

function Signatory({ settings, align = 'center' }: { settings: CertificatePreviewSettings; align?: 'center' | 'left' }) {
  if (!settings.signatoryName) return null
  return (
    <div style={{ textAlign: align, width: pt(170) }}>
      <div style={{ borderTop: `${pt(0.8)} solid ${MIST}`, marginBottom: pt(4) }} />
      <Line size={10} bold>{settings.signatoryName}</Line>
      {settings.signatoryTitle ? <Line size={8.5} color={MUTED}>{settings.signatoryTitle}</Line> : null}
    </div>
  )
}

function Footer({ settings, align = 'center' }: { settings: CertificatePreviewSettings; align?: 'center' | 'left' }) {
  const validity = sampleValidity(settings.validityMonths)
  return (
    <div style={{ textAlign: align }}>
      <Line size={9} bold>Certificate No. {sampleCertificateNumber(settings.serialPrefix)}</Line>
      <Line size={8.5} color={MUTED}>{['Issued on completion', validity].filter(Boolean).join('  ·  ')}</Line>
    </div>
  )
}

function Classic({ settings, courseTitle, mentorName }: CertificatePreviewProps) {
  return (
    <div style={{ position: 'absolute', inset: pt(24), border: `${pt(2)} solid rgb(13 84 107)`, padding: pt(10) }}>
      <div style={{ height: '100%', border: `${pt(0.8)} solid ${MIST}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', textAlign: 'center', padding: `${pt(30)} ${pt(60)} ${pt(24)}` }}>
        <div>
          <Line size={14} bold color={OCEAN}>SEA N SHORE</Line>
          <Line size={9} bold color={MUTED}>GLOBAL SHIPPING COMMUNITY</Line>
        </div>
        <div style={{ display: 'grid', gap: pt(10) }}>
          <Line size={28} bold>CERTIFICATE OF COMPLETION</Line>
          <Line size={11} color={MUTED}>This certifies that</Line>
          <Line size={24} bold color={OCEAN}>{SAMPLE_LEARNER_NAME}</Line>
          <Line size={11} color={MUTED}>has successfully completed</Line>
          <Line size={20} bold>{courseTitle}</Line>
          <Line size={11}>Mentor: {mentorName}</Line>
        </div>
        <Signatory settings={settings} />
        <Footer settings={settings} />
      </div>
    </div>
  )
}

function Modern({ settings, courseTitle, mentorName }: CertificatePreviewProps) {
  const validity = settings.validityMonths ? `${settings.validityMonths} months` : 'No expiry'
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      <div style={{ width: pt(210), background: NAVY, borderRight: `${pt(6)} solid ${TEAL}`, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: pt(40) }}>
        <Line size={12} bold color="rgb(171 232 224)">SEA N SHORE</Line>
        <Line size={9} bold color="rgb(217 230 237)">LEARNING</Line>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: `${pt(90)} ${pt(60)} ${pt(60)}` }}>
        <div style={{ display: 'grid', gap: pt(12) }}>
          <Line size={12} bold color={TEAL}>CERTIFICATE OF COMPLETION</Line>
          <Line size={34} bold>{SAMPLE_LEARNER_NAME}</Line>
          <Line size={11} color={MUTED}>has successfully completed</Line>
          <Line size={20} bold color={OCEAN}>{courseTitle}</Line>
          <Line size={10.5}>Mentor: {mentorName}</Line>
          <div style={{ display: 'flex', gap: pt(40), marginTop: pt(16) }}>
            <div><Line size={7.5} bold color={MUTED}>COMPLETED</Line><Line size={10} bold>On completion</Line></div>
            <div><Line size={7.5} bold color={MUTED}>VALIDITY</Line><Line size={10} bold>{validity}</Line></div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: pt(20) }}>
          <Line size={9} bold>Certificate No. {sampleCertificateNumber(settings.serialPrefix)}</Line>
          <Signatory settings={settings} />
        </div>
      </div>
    </div>
  )
}

function Formal({ settings, courseTitle, mentorName }: CertificatePreviewProps) {
  return (
    <div style={{ position: 'absolute', inset: pt(18), border: `${pt(3)} solid ${GOLD}`, padding: pt(7) }}>
      <div style={{ height: '100%', border: `${pt(1.2)} solid ${NAVY}`, padding: pt(5) }}>
        <div style={{ height: '100%', border: `${pt(0.5)} solid ${GOLD}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', textAlign: 'center', padding: `${pt(30)} ${pt(60)} ${pt(20)}` }}>
          <Line size={13} bold>SEA N SHORE</Line>
          <div style={{ display: 'grid', gap: pt(10), justifyItems: 'center' }}>
            <Line size={30} bold>Certificate of Completion</Line>
            <div style={{ width: pt(240), borderTop: `${pt(1)} solid ${GOLD}` }} />
            <Line size={11} color={MUTED}>This is to certify that</Line>
            <Line size={26} bold>{SAMPLE_LEARNER_NAME}</Line>
            <Line size={11} color={MUTED}>has satisfactorily completed the course</Line>
            <Line size={19} bold color={OCEAN}>{courseTitle}</Line>
            <Line size={9.5} color={MUTED}>Delivered by {mentorName}</Line>
          </div>
          <div style={{ display: 'flex', width: '100%', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <Signatory settings={settings} />
            <Footer settings={settings} />
            <span style={{ display: 'grid', placeItems: 'center', width: pt(80), height: pt(80), borderRadius: '9999px', background: GOLD, color: 'white', fontSize: pt(8), fontWeight: 700 }}>VERIFIED</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Minimal({ settings, courseTitle, mentorName }: CertificatePreviewProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: `${pt(80)} ${pt(90)} ${pt(70)}` }}>
      <Line size={11} bold color={TEAL}>Sea N Shore Learning</Line>
      <div style={{ display: 'grid', gap: pt(14) }}>
        <Line size={13} color={MUTED}>Certificate of completion</Line>
        <Line size={36} bold>{SAMPLE_LEARNER_NAME}</Line>
        <div style={{ width: pt(120), borderTop: `${pt(1.5)} solid ${TEAL}` }} />
        <Line size={18} bold>{courseTitle}</Line>
        <Line size={10} color={MUTED}>{mentorName}</Line>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: pt(20) }}>
        <Footer settings={settings} align="left" />
        <Signatory settings={settings} />
      </div>
    </div>
  )
}

const LAYOUTS = { classic: Classic, modern: Modern, formal: Formal, minimal: Minimal } as const

export function certificatePreviewLabel({ settings, courseTitle, mentorName }: CertificatePreviewProps) {
  const signed = settings.signatoryName ? `, signed by ${settings.signatoryName}${settings.signatoryTitle ? `, ${settings.signatoryTitle}` : ''}` : ''
  const validity = sampleValidity(settings.validityMonths)
  return `Sample certificate of completion for ${courseTitle}, issued to ${SAMPLE_LEARNER_NAME} by ${mentorName}${signed}.${validity ? ` ${validity}.` : ''}`
}

export function CertificatePreview(props: CertificatePreviewProps) {
  const Layout = LAYOUTS[props.settings.template] ?? Classic
  return (
    <div
      role="img"
      aria-label={certificatePreviewLabel(props)}
      data-testid="certificate-preview"
      data-template={props.settings.template}
      className="relative w-full overflow-hidden rounded-lg bg-white shadow-[var(--shadow-card)] ring-1 ring-mist-100"
      style={{ aspectRatio: `${PAGE_WIDTH} / 595.28`, containerType: 'inline-size', fontFamily: 'Helvetica, Arial, sans-serif' }}
    >
      <div aria-hidden="true">
        <Layout {...props} />
      </div>
      <span aria-hidden="true" className="pointer-events-none absolute right-2 top-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-900">
        Sample
      </span>
    </div>
  )
}
