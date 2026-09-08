import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { profileAvailabilityLabel } from './profile-availability'
import type { ProfilePortfolio } from './profile-portfolio-types'
import type { PublicProfile } from './types'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN_X = 48
const MARGIN_TOP = 48
const MARGIN_BOTTOM = 48
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2)

function safePdfText(value: string) {
  return value
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const normalized = safePdfText(text).replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const words = normalized.split(' ')
  const lines: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = word
  }
  if (line) lines.push(line)
  return lines
}

function dateLabel(value: string | null) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function experiencePeriod(startedOn: string | null, endedOn: string | null, current: boolean) {
  const start = dateLabel(startedOn)
  const end = current ? 'Present' : dateLabel(endedOn)
  if (start && end) return `${start} - ${end}`
  return start ?? end ?? null
}

function credentialStatus(state: ProfilePortfolio['credentials'][number]['verificationState']) {
  switch (state) {
    case 'verified': return 'Verified'
    case 'pending': return 'Verification pending'
    case 'rejected': return 'Needs review'
    default: return 'Self-reported'
  }
}

export async function buildProfileCvPdf({
  profile,
  portfolio,
  publicProfileUrl,
}: {
  profile: PublicProfile
  portfolio: ProfilePortfolio
  publicProfileUrl: string
}) {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  pdf.setTitle(`${safePdfText(profile.fullName)} - Maritime CV`)
  pdf.setSubject('Sea N Shore Maritime Passport professional CV')
  pdf.setAuthor(safePdfText(profile.fullName))
  pdf.setCreator('Sea N Shore Global Shipping Community')

  let page!: PDFPage
  let y = 0

  function addPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    y = PAGE_HEIGHT - MARGIN_TOP
    page.drawText('SEA N SHORE  |  MARITIME PASSPORT', {
      x: MARGIN_X,
      y,
      size: 8,
      font: bold,
      color: rgb(0.08, 0.32, 0.45),
    })
    y -= 22
  }

  function ensureSpace(height: number) {
    if (y - height < MARGIN_BOTTOM) addPage()
  }

  function drawLines(lines: string[], options?: { size?: number; lineHeight?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number }) {
    const size = options?.size ?? 10
    const lineHeight = options?.lineHeight ?? 14
    const useFont = options?.font ?? regular
    const color = options?.color ?? rgb(0.17, 0.2, 0.24)
    const indent = options?.indent ?? 0
    ensureSpace(lines.length * lineHeight + 2)
    for (const line of lines) {
      page.drawText(line, { x: MARGIN_X + indent, y, size, font: useFont, color })
      y -= lineHeight
    }
  }

  function paragraph(text: string, options?: { size?: number; lineHeight?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; width?: number }) {
    const font = options?.font ?? regular
    const size = options?.size ?? 10
    const indent = options?.indent ?? 0
    drawLines(wrapText(text, font, size, options?.width ?? (CONTENT_WIDTH - indent)), { ...options, font, size, indent })
  }

  function section(title: string) {
    ensureSpace(40)
    y -= 8
    page.drawText(safePdfText(title.toUpperCase()), {
      x: MARGIN_X,
      y,
      size: 9,
      font: bold,
      color: rgb(0.04, 0.42, 0.55),
    })
    y -= 8
    page.drawLine({
      start: { x: MARGIN_X, y },
      end: { x: PAGE_WIDTH - MARGIN_X, y },
      thickness: 0.7,
      color: rgb(0.83, 0.88, 0.91),
    })
    y -= 17
  }

  function bullet(text: string) {
    const lines = wrapText(text, regular, 9.5, CONTENT_WIDTH - 18)
    if (!lines.length) return
    ensureSpace(lines.length * 13 + 2)
    page.drawText('-', { x: MARGIN_X + 2, y, size: 10, font: bold, color: rgb(0.04, 0.42, 0.55) })
    lines.forEach((line, index) => {
      page.drawText(line, { x: MARGIN_X + 16, y: y - (index * 13), size: 9.5, font: regular, color: rgb(0.17, 0.2, 0.24) })
    })
    y -= lines.length * 13
  }

  addPage()

  paragraph(profile.fullName, { size: 22, lineHeight: 25, font: bold, color: rgb(0.03, 0.15, 0.24) })
  if (profile.headline) paragraph(profile.headline, { size: 11.5, lineHeight: 16, font: bold, color: rgb(0.04, 0.42, 0.55) })

  const meta = [
    profile.location,
    profile.currentCompany,
    profileAvailabilityLabel(profile.availability) ? `Status: ${profileAvailabilityLabel(profile.availability)}` : null,
  ].filter((value): value is string => Boolean(value))
  if (meta.length) paragraph(meta.join('  |  '), { size: 9.5, lineHeight: 14, color: rgb(0.35, 0.4, 0.44) })
  y -= 4
  paragraph(publicProfileUrl, { size: 8.5, lineHeight: 12, color: rgb(0.35, 0.4, 0.44) })

  if (profile.summary) {
    section('Professional summary')
    paragraph(profile.summary, { size: 10, lineHeight: 14 })
  }

  const snapshot: string[] = []
  if (profile.rank) snapshot.push(`Rank: ${profile.rank}`)
  if (profile.sailingExperienceYears != null) snapshot.push(`Sea service: ${profile.sailingExperienceYears} years`)
  if (profile.currentVessel) snapshot.push(`Current vessel: ${profile.currentVessel}`)
  if (profile.vesselTypes.length) snapshot.push(`Vessel types: ${profile.vesselTypes.join(', ')}`)
  if (profile.tradingAreas.length) snapshot.push(`Trading areas: ${profile.tradingAreas.join(', ')}`)
  if (profile.shoreCareerPreference) snapshot.push('Career preference: Interested in shore opportunities')
  if (snapshot.length) {
    section('Maritime snapshot')
    snapshot.forEach(bullet)
  }

  if (portfolio.experiences.length) {
    section('Career experience')
    for (const experience of portfolio.experiences) {
      ensureSpace(74)
      paragraph(experience.title, { size: 11, lineHeight: 15, font: bold, color: rgb(0.03, 0.15, 0.24) })
      const context = [
        experience.organization,
        experience.vessel,
        experience.vesselType,
        experience.location,
        experiencePeriod(experience.startedOn, experience.endedOn, experience.isCurrent),
      ].filter((value): value is string => Boolean(value))
      if (context.length) paragraph(context.join('  |  '), { size: 9, lineHeight: 13, color: rgb(0.35, 0.4, 0.44) })
      if (experience.description) paragraph(experience.description, { size: 9.5, lineHeight: 13 })
      if (experience.cargoExperience.length) bullet(`Cargo experience: ${experience.cargoExperience.join(', ')}`)
      if (experience.engineExperience.length) bullet(`Engine experience: ${experience.engineExperience.join(', ')}`)
      if (experience.tradingAreas.length) bullet(`Trading areas: ${experience.tradingAreas.join(', ')}`)
      y -= 8
    }
  }

  if (portfolio.credentials.length) {
    section('Certificates and credentials')
    for (const credential of portfolio.credentials) {
      ensureSpace(58)
      paragraph(credential.name, { size: 10.5, lineHeight: 14, font: bold, color: rgb(0.03, 0.15, 0.24) })
      paragraph(credential.issuer, { size: 9.5, lineHeight: 13 })
      const details = [
        credential.credentialNumber ? `Credential: ${credential.credentialNumber}` : null,
        credential.issuedOn ? `Issued: ${dateLabel(credential.issuedOn)}` : null,
        credential.noExpiry ? 'No expiry' : credential.expiresOn ? `Expires: ${dateLabel(credential.expiresOn)}` : null,
        credentialStatus(credential.verificationState),
      ].filter((value): value is string => Boolean(value))
      paragraph(details.join('  |  '), { size: 8.8, lineHeight: 12, color: rgb(0.35, 0.4, 0.44) })
      y -= 7
    }
  }

  if (profile.skills.length) {
    section('Skills')
    paragraph(profile.skills.join('  |  '), { size: 9.5, lineHeight: 14 })
  }

  ensureSpace(50)
  y -= 16
  page.drawLine({
    start: { x: MARGIN_X, y },
    end: { x: PAGE_WIDTH - MARGIN_X, y },
    thickness: 0.5,
    color: rgb(0.83, 0.88, 0.91),
  })
  y -= 16
  paragraph('Generated from the member\'s Sea N Shore Maritime Passport. Credential verification labels reflect the current stored review state; self-reported credentials are not presented as formally verified.', {
    size: 7.8,
    lineHeight: 11,
    color: rgb(0.43, 0.47, 0.5),
  })

  return pdf.save()
}
