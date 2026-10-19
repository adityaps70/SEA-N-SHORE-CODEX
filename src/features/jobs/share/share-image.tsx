import type { ReactNode } from 'react'
import type { ShareContent } from './share-content'
import { FACTS_BORDER, type ShareLayout } from './share-layout'
import type { ShareBadge, ShareLook } from './share-options'
import { SHARE_BADGES, SHARE_THEMES } from './share-themes'
import { SHARE_FONT_FAMILY } from './text-fit'

/**
 * Round I (I1): the job share image as a Satori tree (next/og). Every block sits in the box share-layout gave it,
 * and every line of text is drawn as measured (no wrapping here), so nothing can spill out of its box.
 */
export type ShareImageAssets = {
  /** PNG data URLs, made on the server (share-render). */
  companyLogo: string | null
  brandLogo: { src: string; width: number; height: number } | null
  partnerLogos: Array<{ name: string; src: string; width: number; height: number }>
  qr: string | null
}

const font = (role: keyof typeof SHARE_FONT_FAMILY) => ({ fontFamily: SHARE_FONT_FAMILY[role].family, fontWeight: SHARE_FONT_FAMILY[role].weight })

function ChipIcon({ kind, size, color }: { kind: ShareContent['chips'][number]['kind']; size: number; color: string }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'location') {
    return (
      <svg {...common}>
        <path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    )
  }
  if (kind === 'salary') {
    return (
      <svg {...common}>
        <rect width="20" height="12" x="2" y="6" rx="2" />
        <circle cx="12" cy="12" r="2.4" />
        <path d="M6 12h.01M18 12h.01" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M8 2v4M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  )
}

function Lines({ lines, size, lineHeight, color, role, letterSpacing = 0 }: { lines: string[]; size: number; lineHeight: number; color: string; role: keyof typeof SHARE_FONT_FAMILY; letterSpacing?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {lines.map((line, index) => (
        <div key={index} style={{ display: 'flex', fontSize: size, lineHeight: `${Math.round(size * lineHeight)}px`, height: Math.round(size * lineHeight), color, whiteSpace: 'nowrap', letterSpacing, ...font(role) }}>{line}</div>
      ))}
    </div>
  )
}

export function ShareImage({ content, layout, look, badge, assets }: {
  content: ShareContent
  layout: ShareLayout
  look: ShareLook
  badge: ShareBadge
  assets: ShareImageAssets
}): ReactNode {
  const theme = SHARE_THEMES[look]
  const badgeColors = SHARE_BADGES[badge]
  const { width, height, footer, main, side } = layout
  const partnerTop = height - footer.height - (layout.partners ? layout.partners.height + layout.gap : 0)

  const factsPanel = layout.facts ? (
    <div style={{ display: 'flex', flexDirection: 'column', width: side ? side.width : main.width, padding: layout.facts.padding, borderRadius: Math.round(layout.facts.padding * 0.9), backgroundColor: theme.panelBackground, border: `${FACTS_BORDER}px solid ${theme.chipBorder}` }}>
      <div style={{ display: 'flex', fontSize: layout.facts.headingSize, lineHeight: `${Math.round(layout.facts.headingSize * 1.6)}px`, color: theme.panelMuted, letterSpacing: 2, ...font('heading') }}>JOB DETAILS</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', width: (side ? side.width : main.width) - layout.facts.padding * 2 - FACTS_BORDER * 2, columnGap: Math.round(layout.facts.valueSize * 0.8), rowGap: Math.round(layout.facts.valueSize * 0.8) }}>
        {layout.facts.cells.map((cell) => (
          <div key={cell.label} style={{ display: 'flex', flexDirection: 'column', width: layout.facts!.cellWidth }}>
            <div style={{ display: 'flex', fontSize: layout.facts!.labelSize, lineHeight: `${Math.round(layout.facts!.labelSize * 1.35)}px`, color: theme.panelMuted, ...font('bodyStrong') }}>{cell.label}</div>
            <Lines lines={cell.lines} size={layout.facts!.valueSize} lineHeight={layout.facts!.valueLineHeight} color={theme.panelText} role="heading" />
          </div>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div style={{ display: 'flex', position: 'relative', width, height, backgroundImage: `linear-gradient(180deg, ${theme.background[0]}, ${theme.background[1]})`, ...font('body') }}>
      {/* Two soft rings in the corner, in the look's accent colour. */}
      <div style={{ display: 'flex', position: 'absolute', right: -Math.round(width * 0.18), top: -Math.round(width * 0.18), width: Math.round(width * 0.55), height: Math.round(width * 0.55), borderRadius: 9999, border: `${Math.round(width * 0.03)}px solid ${theme.accent}`, opacity: 0.14 }} />
      <div style={{ display: 'flex', position: 'absolute', right: -Math.round(width * 0.05), top: -Math.round(width * 0.05), width: Math.round(width * 0.3), height: Math.round(width * 0.3), borderRadius: 9999, border: `${Math.round(width * 0.016)}px solid ${theme.accent}`, opacity: 0.2 }} />

      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: main.x, top: main.y, width: main.width, rowGap: layout.gap }}>
        <div style={{ display: 'flex' }}>
          <div style={{ display: 'flex', alignItems: 'center', height: layout.badge.height, paddingLeft: layout.badge.padX, paddingRight: layout.badge.padX, borderRadius: 9999, backgroundColor: badgeColors.background, color: badgeColors.text, fontSize: layout.badge.fontSize, letterSpacing: Math.round(layout.badge.fontSize * 0.06), ...font('heading') }}>{layout.badge.text}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: layout.company.labelSize, lineHeight: `${Math.round(layout.company.labelSize * 1.5)}px`, color: theme.muted, ...font('bodyStrong') }}>Hiring for</div>
          <div style={{ display: 'flex', alignItems: 'center', columnGap: layout.company.gap }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: layout.company.logoSize, height: layout.company.logoSize, borderRadius: Math.round(layout.company.logoSize * 0.22), backgroundColor: '#ffffff', border: `3px solid ${theme.accent}`, overflow: 'hidden' }}>
              {assets.companyLogo
                // eslint-disable-next-line @next/next/no-img-element -- drawn into the PNG by Satori, not served as HTML
                ? <img src={assets.companyLogo} alt={content.company.name} width={Math.round(layout.company.logoSize * 0.82)} height={Math.round(layout.company.logoSize * 0.82)} style={{ objectFit: 'contain' }} />
                : <div style={{ display: 'flex', fontSize: Math.round(layout.company.logoSize * 0.38), color: '#071b2d', ...font('title') }}>{content.company.initials}</div>}
            </div>
            <Lines lines={layout.company.name.lines} size={layout.company.name.size} lineHeight={layout.company.name.lineHeight} color={theme.text} role="heading" />
          </div>
        </div>

        <Lines lines={layout.title.lines} size={layout.title.size} lineHeight={layout.title.lineHeight} color={theme.text} role="title" letterSpacing={-Math.round(layout.title.size * 0.015)} />

        <div style={{ display: 'flex', flexDirection: 'column', rowGap: layout.chips.gap }}>
          {layout.chips.rows.map((row, index) => (
            <div key={index} style={{ display: 'flex', columnGap: layout.chips.gap }}>
              {row.map((chip) => (
                <div key={chip.kind} style={{ display: 'flex', alignItems: 'center', columnGap: Math.round(layout.chips.fontSize * 0.4), height: layout.chips.height, paddingLeft: layout.chips.padX, paddingRight: layout.chips.padX, borderRadius: 9999, backgroundColor: theme.chipBackground, border: `2px solid ${theme.chipBorder}` }}>
                  <ChipIcon kind={chip.kind} size={layout.chips.iconSize} color={theme.chipText} />
                  <div style={{ display: 'flex', fontSize: layout.chips.fontSize, color: theme.chipText, whiteSpace: 'nowrap', ...font('bodyStrong') }}>{chip.text}</div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {side ? null : factsPanel}
      </div>

      {side && factsPanel ? <div style={{ display: 'flex', position: 'absolute', left: side.x, top: side.y }}>{factsPanel}</div> : null}

      {layout.partners && assets.partnerLogos.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: layout.padding, top: partnerTop, width: width - layout.padding * 2 }}>
          <div style={{ display: 'flex', fontSize: layout.partners.labelSize, lineHeight: `${Math.round(layout.partners.labelSize * 1.4)}px`, color: theme.muted, ...font('bodyStrong') }}>In partnership with</div>
          <div style={{ display: 'flex', alignItems: 'center', columnGap: Math.round(layout.partners.logoHeight * 0.5), height: layout.partners.logoHeight }}>
            {assets.partnerLogos.map((partner) => (
              <div key={partner.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: layout.partners!.logoHeight, padding: Math.round(layout.partners!.logoHeight * 0.12), borderRadius: 12, backgroundColor: '#ffffff' }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- drawn into the PNG by Satori */}
                <img src={partner.src} alt={partner.name} width={partner.width} height={partner.height} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', position: 'absolute', left: 0, bottom: 0, width, height: footer.height, backgroundColor: theme.footerBackground, alignItems: 'center', justifyContent: 'space-between', paddingLeft: layout.padding, paddingRight: layout.padding }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: footer.textWidth }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn into the PNG by Satori */}
          {assets.brandLogo ? <img src={assets.brandLogo.src} alt="Sea N Shore" width={assets.brandLogo.width} height={assets.brandLogo.height} /> : null}
          <div style={{ display: 'flex', fontSize: footer.applySize, lineHeight: `${Math.round(footer.applySize * 1.2)}px`, color: theme.footerText, ...font('heading') }}>Apply on Sea N Shore</div>
          <div style={{ display: 'flex', fontSize: footer.hostSize, lineHeight: `${Math.round(footer.hostSize * 1.25)}px`, color: theme.footerMuted, ...font('bodyStrong') }}>{footer.host}</div>
          {footer.socialLines.map((line) => <div key={line} style={{ display: 'flex', fontSize: footer.socialSize, lineHeight: `${Math.round(footer.socialSize * 1.3)}px`, color: theme.footerMuted, whiteSpace: 'nowrap', ...font('body') }}>{line}</div>)}
        </div>
        {assets.qr && footer.qrSize ? (
          <div style={{ display: 'flex', width: footer.qrSize, height: footer.qrSize, padding: Math.round(footer.qrSize * 0.05), borderRadius: Math.round(footer.qrSize * 0.08), backgroundColor: '#ffffff' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- drawn into the PNG by Satori */}
            <img src={assets.qr} alt="QR code to the job" width={Math.round(footer.qrSize * 0.9)} height={Math.round(footer.qrSize * 0.9)} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
