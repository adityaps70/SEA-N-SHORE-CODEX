import type { ShareContent } from './share-content'
import { SHARE_SIZES, type ShareSize } from './share-options'
import { fitText, measureText, truncateToWidth, wrapText, type FittedText } from './text-fit'

/**
 * Round I (I1): where everything goes on the job share image, for one size. Every text block is measured with the
 * real fonts and placed in a box of known size: the title shrinks (up to 3 lines) to the height that is left, chips
 * shorten with "…", fact values take at most 2 lines. `checks` lists each box and whether its text stays inside
 * it; `fits` is true when all do. By construction it always is (share-layout.test proves it with extreme jobs),
 * and the panel's "Fits" indicator shows the same value.
 */
type Box = { x: number; y: number; width: number; height: number }

export type ChipLayout = { kind: ShareContent['chips'][number]['kind']; text: string; width: number }
export type FactLayout = { label: string; lines: string[] }

export type ShareLayout = {
  size: ShareSize
  width: number
  height: number
  padding: number
  landscape: boolean
  badge: { text: string; fontSize: number; height: number; padX: number; width: number }
  company: { labelSize: number; logoSize: number; name: FittedText; nameWidth: number; gap: number }
  title: FittedText & { width: number }
  chips: { fontSize: number; height: number; padX: number; gap: number; iconSize: number; rows: ChipLayout[][] }
  facts: { headingSize: number; labelSize: number; valueSize: number; valueLineHeight: number; padding: number; columns: number; cellWidth: number; cells: FactLayout[]; height: number } | null
  partners: { labelSize: number; logoHeight: number; logoMaxWidth: number; height: number } | null
  footer: { height: number; padding: number; logoHeight: number; applySize: number; hostSize: number; socialSize: number; socials: string[]; socialLines: string[]; host: string; qrSize: number | null; textWidth: number }
  /** The left (main) column, and in landscape the right column for the facts. */
  main: Box
  side: Box | null
  gap: number
  checks: Array<{ name: string; ok: boolean }>
  fits: boolean
}

type Geometry = {
  padding: number
  gap: number
  badgeSize: number
  labelSize: number
  logoSize: number
  companyMax: number
  companyMin: number
  titleMax: number
  titleMin: number
  chipSize: number
  factValueSize: number
  footerHeight: number
  landscape: boolean
}

const GEOMETRY: Record<ShareSize, Geometry> = {
  square: { padding: 64, gap: 26, badgeSize: 26, labelSize: 22, logoSize: 88, companyMax: 36, companyMin: 24, titleMax: 84, titleMin: 34, chipSize: 24, factValueSize: 26, footerHeight: 196, landscape: false },
  portrait: { padding: 72, gap: 32, badgeSize: 28, labelSize: 24, logoSize: 100, companyMax: 40, companyMin: 26, titleMax: 96, titleMin: 36, chipSize: 26, factValueSize: 28, footerHeight: 220, landscape: false },
  story: { padding: 84, gap: 44, badgeSize: 32, labelSize: 26, logoSize: 120, companyMax: 46, companyMin: 30, titleMax: 112, titleMin: 40, chipSize: 30, factValueSize: 32, footerHeight: 280, landscape: false },
  linkedin: { padding: 44, gap: 18, badgeSize: 20, labelSize: 17, logoSize: 64, companyMax: 28, companyMin: 18, titleMax: 56, titleMin: 24, chipSize: 18, factValueSize: 20, footerHeight: 124, landscape: true },
}

const TITLE_LINE_HEIGHT = 1.08
const COMPANY_LINE_HEIGHT = 1.15
const FACT_LINE_HEIGHT = 1.2
export const FACTS_BORDER = 2

function chipRows(chips: ShareContent['chips'], fontSize: number, maxWidth: number, maxRows: number) {
  const padX = Math.round(fontSize * 0.85)
  const iconSize = Math.round(fontSize * 0.95)
  const gap = Math.round(fontSize * 0.5)
  const inner = maxWidth - padX * 2 - iconSize - Math.round(fontSize * 0.4)
  const laid = chips.map((chip) => {
    const text = truncateToWidth(chip.text, 'bodyStrong', fontSize, inner)
    return { kind: chip.kind, text, width: Math.ceil(measureText(text, 'bodyStrong', fontSize) + padX * 2 + iconSize + fontSize * 0.4) }
  })
  const rows: ChipLayout[][] = []
  for (const chip of laid) {
    const row = rows.at(-1)
    const used = row ? row.reduce((sum, item) => sum + item.width, 0) + gap * row.length : 0
    if (row && used + chip.width <= maxWidth) row.push(chip)
    else rows.push([chip])
  }
  return { padX, iconSize, gap, rows: rows.slice(0, maxRows), dropped: Math.max(0, rows.length - maxRows) }
}

/**
 * How much the other blocks give up when the title would not get its minimum room: fact values on one line, then
 * the "Posted" chip left out when the chips need two rows, and the company name on one line. The first level that
 * fits is used.
 */
type Level = { factLines: 1 | 2; dropPostedChip: boolean; companyLines: 1 | 2 }
const LEVELS: Level[] = [
  { factLines: 2, dropPostedChip: false, companyLines: 2 },
  { factLines: 1, dropPostedChip: false, companyLines: 2 },
  { factLines: 1, dropPostedChip: true, companyLines: 2 },
  { factLines: 1, dropPostedChip: true, companyLines: 1 },
]

export function layoutShareImage(content: ShareContent, size: ShareSize): ShareLayout {
  let layout: ShareLayout | null = null
  for (const level of LEVELS) {
    layout = layoutAtLevel(content, size, level)
    if (layout.fits) return layout
  }
  return layout!
}

function layoutAtLevel(content: ShareContent, size: ShareSize, level: Level): ShareLayout {
  const g = GEOMETRY[size]
  const { width, height } = SHARE_SIZES[size]
  const checks: ShareLayout['checks'] = []
  const P = g.padding
  const contentWidth = width - P * 2

  // Footer: brand, "Apply on Sea N Shore", the site address, the social handles, and the QR code.
  const footerPadding = Math.round(g.footerHeight * 0.14)
  const qrSize = content.qrUrl ? g.footerHeight - footerPadding * 2 : null
  const footerTextWidth = contentWidth - (qrSize ? qrSize + P / 2 : 0)
  const footer = {
    height: g.footerHeight,
    padding: footerPadding,
    logoHeight: Math.round(g.footerHeight * 0.22),
    applySize: Math.round(g.footerHeight * 0.14),
    hostSize: Math.round(g.footerHeight * 0.11),
    socialSize: Math.round(g.footerHeight * 0.085),
    socials: [] as string[],
    socialLines: [] as string[],
    host: '',
    qrSize,
    textWidth: footerTextWidth,
  }
  footer.host = truncateToWidth(content.footer.siteHost, 'bodyStrong', footer.hostSize, footerTextWidth)
  // Socials: all on one line, shrinking it to 80% if needed; else on two lines when the footer has the height;
  // else as many as fit on one line. A handle is never cut.
  const footerBaseHeight = footer.logoHeight + footer.applySize * 1.2 + footer.hostSize * 1.25
  const footerInner = g.footerHeight - footerPadding * 2 + 1
  const smallestSocialSize = Math.ceil(footer.socialSize * 0.8)
  const fitsLine = (handles: string[], size: number) => measureText(handles.join('  ·  '), 'body', size) <= footerTextWidth
  const handles = content.footer.socials
  let socialSize = footer.socialSize
  while (socialSize > smallestSocialSize && !fitsLine(handles, socialSize)) socialSize -= 1
  footer.socialSize = socialSize
  const wrap = (size: number) => {
    const lines: string[][] = []
    for (const handle of handles) {
      const line = lines.at(-1)
      if (line && fitsLine([...line, handle], size)) line.push(handle)
      else if (fitsLine([handle], size)) lines.push([handle])
    }
    return lines
  }
  let lines = wrap(footer.socialSize)
  if (lines.length > 1 && (lines.length > 2 || footerBaseHeight + footer.socialSize * 1.3 * lines.length > footerInner)) lines = lines.slice(0, 1)
  footer.socials = lines.flat()
  footer.socialLines = lines.map((line) => line.join('  ·  '))
  const footerTextHeight = footerBaseHeight + footer.socialSize * 1.3 * footer.socialLines.length
  checks.push({ name: 'footer text', ok: footerTextHeight <= g.footerHeight - footerPadding * 2 + 1 })
  checks.push({ name: 'footer qr', ok: qrSize === null || qrSize <= g.footerHeight - footerPadding * 2 })

  // Partner strip, above the footer.
  const partners = content.partners.length
    ? { labelSize: Math.round(g.labelSize * 0.85), logoHeight: Math.round(g.logoSize * 0.55), logoMaxWidth: Math.round(g.logoSize * 1.8), height: 0 }
    : null
  if (partners) partners.height = Math.round(partners.labelSize * 1.4 + partners.logoHeight)

  const top = P
  const bottom = height - g.footerHeight - (partners ? partners.height + g.gap : 0) - Math.round(P * 0.75)
  const columnGap = Math.round(P * 0.75)
  const mainWidth = g.landscape ? Math.round((contentWidth - columnGap) * 0.6) : contentWidth
  const sideWidth = g.landscape ? contentWidth - columnGap - mainWidth : 0
  const main: Box = { x: P, y: top, width: mainWidth, height: bottom - top }
  const side: Box | null = g.landscape ? { x: P + mainWidth + columnGap, y: top, width: sideWidth, height: bottom - top } : null

  // Badge.
  const badgeText = content.label.toUpperCase()
  const badgePadX = Math.round(g.badgeSize * 0.9)
  const badge = {
    text: truncateToWidth(badgeText, 'heading', g.badgeSize, main.width - badgePadX * 2),
    fontSize: g.badgeSize,
    height: Math.round(g.badgeSize * 2.1),
    padX: badgePadX,
    width: 0,
  }
  badge.width = Math.ceil(measureText(badge.text, 'heading', g.badgeSize) + badgePadX * 2 + badge.text.length * g.badgeSize * 0.06)
  checks.push({ name: 'badge', ok: badge.width <= main.width })

  // "Hiring for" + logo + company name (up to 2 lines).
  const companyGap = Math.round(g.logoSize * 0.22)
  const nameWidth = main.width - g.logoSize - companyGap
  const name = fitText({ text: content.company.name, role: 'heading', maxWidth: nameWidth, maxHeight: g.logoSize * 1.25, maxLines: level.companyLines, maxSize: g.companyMax, minSize: g.companyMin, lineHeight: COMPANY_LINE_HEIGHT })
  const company = { labelSize: g.labelSize, logoSize: g.logoSize, name, nameWidth, gap: companyGap }
  const companyHeight = Math.round(g.labelSize * 1.5) + Math.max(g.logoSize, name.lines.length * name.size * COMPANY_LINE_HEIGHT)
  checks.push({ name: 'company name', ok: name.lines.length <= 2 && name.lines.every((line) => measureText(line, 'heading', name.size) <= nameWidth + 0.5) })

  // Chips: location, salary, posted (at most 2 rows; in landscape at most 2 too).
  let chipLayout = chipRows(content.chips, g.chipSize, main.width, 2)
  if (level.dropPostedChip && chipLayout.rows.length > 1) chipLayout = chipRows(content.chips.filter((chip) => chip.kind !== 'posted'), g.chipSize, main.width, 2)
  const chips = { fontSize: g.chipSize, height: Math.round(g.chipSize * 2.1), padX: chipLayout.padX, gap: chipLayout.gap, iconSize: chipLayout.iconSize, rows: chipLayout.rows }
  const chipsHeight = chips.rows.length * chips.height + Math.max(0, chips.rows.length - 1) * chips.gap
  checks.push({ name: 'chips', ok: chips.rows.every((row) => row.reduce((sum, chip) => sum + chip.width, 0) + chips.gap * (row.length - 1) <= main.width + 0.5) && chipLayout.dropped === 0 })

  // Job Details: up to four facts, in two columns (one in landscape), each value at most 2 lines.
  let facts: ShareLayout['facts'] = null
  let factsHeight = 0
  if (content.facts.length) {
    const box = side ?? main
    const columns = side || content.facts.length === 1 ? 1 : 2
    const padding = Math.round(g.factValueSize * 0.9)
    const cellGap = Math.round(g.factValueSize * 0.8)
    // The panel has a 2px border on each side, inside its width.
    const cellWidth = Math.floor((box.width - padding * 2 - FACTS_BORDER * 2 - cellGap * (columns - 1)) / columns)
    const valueSize = g.factValueSize
    const labelSize = Math.round(valueSize * 0.72)
    const cells = content.facts.map((fact) => {
      const lines = wrapText(fact.value, 'heading', valueSize, cellWidth)
      const kept = lines.slice(0, level.factLines)
      if (lines.length > level.factLines) {
        kept[level.factLines - 1] = truncateToWidth(lines.slice(level.factLines - 1).join(' '), 'heading', valueSize, cellWidth)
      }
      return { label: fact.label, lines: kept }
    })
    const rows: FactLayout[][] = []
    for (let index = 0; index < cells.length; index += columns) rows.push(cells.slice(index, index + columns))
    const rowHeight = (row: FactLayout[]) => labelSize * 1.35 + Math.max(...row.map((cell) => cell.lines.length)) * valueSize * FACT_LINE_HEIGHT
    const headingSize = Math.round(valueSize * 0.8)
    factsHeight = Math.ceil(padding * 2 + FACTS_BORDER * 2 + headingSize * 1.6 + rows.reduce((sum, row) => sum + rowHeight(row), 0) + cellGap * (rows.length - 1))
    facts = { headingSize, labelSize, valueSize, valueLineHeight: FACT_LINE_HEIGHT, padding, columns, cellWidth, cells, height: factsHeight }
    checks.push({ name: 'job details text', ok: cells.every((cell) => cell.lines.length <= 2 && cell.lines.every((line) => measureText(line, 'heading', valueSize) <= cellWidth + 0.5)) })
    if (side) checks.push({ name: 'job details height', ok: factsHeight <= side.height })
  }

  // The title takes the height that is left in the main column.
  const fixed = badge.height + companyHeight + chipsHeight + (side ? 0 : factsHeight)
  const gaps = g.gap * (side ? 3 : facts ? 4 : 3)
  const titleRoom = main.height - fixed - gaps
  const title = fitText({ text: content.title, role: 'title', maxWidth: main.width, maxHeight: titleRoom, maxLines: 3, maxSize: g.titleMax, minSize: g.titleMin, lineHeight: TITLE_LINE_HEIGHT })
  checks.push({ name: 'title room', ok: titleRoom >= g.titleMin * TITLE_LINE_HEIGHT })
  checks.push({ name: 'title lines', ok: title.lines.length >= 1 && title.lines.length <= 3 })
  checks.push({ name: 'title width', ok: title.lines.every((line) => measureText(line, 'title', title.size) <= main.width + 0.5) })
  const used = fixed + gaps + title.lines.length * title.size * TITLE_LINE_HEIGHT
  checks.push({ name: 'main column height', ok: used <= main.height + 0.5 })
  // Spare height (tall sizes, short jobs) is shared out: a third above the content, the rest below it.
  const offset = Math.round(Math.max(0, main.height - used) / 3)

  return {
    size,
    width,
    height,
    padding: P,
    landscape: g.landscape,
    badge,
    company,
    title: { ...title, width: main.width },
    chips,
    facts,
    partners,
    footer,
    main: { ...main, y: main.y + offset, height: main.height - offset },
    side,
    gap: g.gap,
    checks,
    fits: checks.every((check) => check.ok),
  }
}
