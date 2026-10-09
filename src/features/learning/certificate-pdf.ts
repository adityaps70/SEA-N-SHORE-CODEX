import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib'
import type { LearningCertificate } from './certificate-repository'
import { certificateDisplayNumber } from './certificate-settings'

function safeText(value: string) {
  return value
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export type CertificateImage = { bytes: Uint8Array; contentType: string | null }

const NAVY = rgb(0.04, 0.15, 0.22)
const OCEAN = rgb(0.04, 0.42, 0.55)
const TEAL = rgb(0.05, 0.55, 0.52)
const MUTED = rgb(0.35, 0.4, 0.44)
const MIST = rgb(0.73, 0.82, 0.84)
const GOLD = rgb(0.72, 0.53, 0.18)

type Canvas = {
  page: PDFPage
  width: number
  height: number
  regular: PDFFont
  bold: PDFFont
  logo: PDFImage | null
  signature: PDFImage | null
}

async function embedImage(pdf: PDFDocument, image: CertificateImage | null | undefined) {
  if (!image) return null
  try {
    const isPng = image.contentType === 'image/png' || (image.bytes[0] === 0x89 && image.bytes[1] === 0x50)
    return isPng ? await pdf.embedPng(image.bytes) : await pdf.embedJpg(image.bytes)
  } catch {
    // A picture that cannot be read never stops the certificate.
    return null
  }
}

function textAt(canvas: Canvas, text: string, x: number, y: number, size: number, useBold = false, color: RGB = NAVY) {
  canvas.page.drawText(safeText(text), { x, y, size, font: useBold ? canvas.bold : canvas.regular, color })
}

function widthOf(canvas: Canvas, text: string, size: number, useBold = false) {
  return (useBold ? canvas.bold : canvas.regular).widthOfTextAtSize(safeText(text), size)
}

/** Shrinks long names and titles so they always fit `maxWidth`. */
function fitted(canvas: Canvas, text: string, size: number, maxWidth: number, useBold = true) {
  let current = size
  while (current > 9 && widthOf(canvas, text, current, useBold) > maxWidth) current -= 1
  return current
}

function centered(canvas: Canvas, text: string, y: number, size: number, useBold = false, color: RGB = NAVY, maxWidth = canvas.width - 160) {
  const fit = fitted(canvas, text, size, maxWidth, useBold)
  textAt(canvas, text, (canvas.width - widthOf(canvas, text, fit, useBold)) / 2, y, fit, useBold, color)
}

function drawImageFitted(canvas: Canvas, image: PDFImage, x: number, y: number, maxWidth: number, maxHeight: number, align: 'left' | 'center' = 'center') {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1)
  const width = image.width * scale
  const height = image.height * scale
  canvas.page.drawImage(image, { x: align === 'center' ? x - width / 2 : x, y, width, height })
}

function validityLine(certificate: LearningCertificate) {
  return certificate.expiresAt ? `Valid until ${dateLabel(certificate.expiresAt)}` : null
}

/** Signature image, line, name and title, centred on x. */
function signatureBlock(canvas: Canvas, certificate: LearningCertificate, x: number, y: number) {
  if (!canvas.signature && !certificate.signatoryName) return
  if (canvas.signature) drawImageFitted(canvas, canvas.signature, x, y + 8, 150, 42)
  canvas.page.drawLine({ start: { x: x - 85, y: y + 4 }, end: { x: x + 85, y: y + 4 }, thickness: 0.7, color: MIST })
  if (certificate.signatoryName) {
    const size = fitted(canvas, certificate.signatoryName, 10, 170)
    textAt(canvas, certificate.signatoryName, x - widthOf(canvas, certificate.signatoryName, size, true) / 2, y - 10, size, true)
  }
  if (certificate.signatoryTitle) {
    const size = fitted(canvas, certificate.signatoryTitle, 8.5, 170, false)
    textAt(canvas, certificate.signatoryTitle, x - widthOf(canvas, certificate.signatoryTitle, size) / 2, y - 23, size, false, MUTED)
  }
}

/** Certificates issued before learning round B: the original layout, unchanged. */
function drawOriginal(canvas: Canvas, certificate: LearningCertificate, verificationUrl: string) {
  const { page, width, height } = canvas
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderWidth: 2, borderColor: rgb(0.05, 0.33, 0.42) })
  page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderWidth: 0.8, borderColor: MIST })
  centered(canvas, 'SEA N SHORE', height - 90, 14, true, OCEAN)
  centered(canvas, 'GLOBAL SHIPPING COMMUNITY', height - 109, 9, true, MUTED)
  centered(canvas, 'CERTIFICATE OF COMPLETION', height - 165, 28, true)
  centered(canvas, 'This certifies that', height - 208, 11, false, MUTED)
  centered(canvas, certificate.learnerName, height - 252, 24, true, OCEAN)
  centered(canvas, 'has successfully completed', height - 286, 11, false, MUTED)
  centered(canvas, certificate.courseTitle, height - 329, 20, true)
  centered(canvas, `Mentor: ${certificate.mentorName}`, height - 360, 11)
  centered(canvas, `Completed on ${dateLabel(certificate.completedAt)}`, height - 386, 10, false, MUTED)
  page.drawLine({ start: { x: 120, y: 150 }, end: { x: width - 120, y: 150 }, thickness: 0.7, color: MIST })
  centered(canvas, `Certificate No. ${certificate.certificateNumber}`, 126, 9, true)
  centered(canvas, `Issued ${dateLabel(certificate.issuedAt)}`, 108, 8.5, false, MUTED)
  centered(canvas, `Verify: ${verificationUrl}`, 82, 8, false, OCEAN)
}

function drawClassic(canvas: Canvas, certificate: LearningCertificate, verificationUrl: string) {
  const { page, width, height } = canvas
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderWidth: 2, borderColor: rgb(0.05, 0.33, 0.42) })
  page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderWidth: 0.8, borderColor: MIST })
  if (canvas.logo) drawImageFitted(canvas, canvas.logo, width / 2, height - 118, 150, 46)
  else {
    centered(canvas, 'SEA N SHORE', height - 90, 14, true, OCEAN)
    centered(canvas, 'GLOBAL SHIPPING COMMUNITY', height - 109, 9, true, MUTED)
  }
  centered(canvas, 'CERTIFICATE OF COMPLETION', height - 165, 28, true)
  centered(canvas, 'This certifies that', height - 205, 11, false, MUTED)
  centered(canvas, certificate.learnerName, height - 247, 24, true, OCEAN)
  centered(canvas, 'has successfully completed', height - 279, 11, false, MUTED)
  centered(canvas, certificate.courseTitle, height - 318, 20, true)
  centered(canvas, `Mentor: ${certificate.mentorName}`, height - 346, 11)
  centered(canvas, `Completed on ${dateLabel(certificate.completedAt)}`, height - 368, 10, false, MUTED)
  signatureBlock(canvas, certificate, width / 2, 175)
  centered(canvas, `Certificate No. ${certificateDisplayNumber(certificate)}`, 118, 9, true)
  centered(canvas, [`Issued ${dateLabel(certificate.issuedAt)}`, validityLine(certificate)].filter(Boolean).join('  ·  '), 102, 8.5, false, MUTED)
  centered(canvas, `Verify: ${verificationUrl}`, 78, 8, false, OCEAN)
}

function drawModern(canvas: Canvas, certificate: LearningCertificate, verificationUrl: string) {
  const { page, width, height } = canvas
  const band = 210
  page.drawRectangle({ x: 0, y: 0, width: band, height, color: NAVY })
  page.drawRectangle({ x: band, y: 0, width: 6, height, color: TEAL })
  if (canvas.logo) drawImageFitted(canvas, canvas.logo, 40, height - 110, 130, 60, 'left')
  textAt(canvas, 'SEA N SHORE', 40, 120, 12, true, rgb(0.67, 0.91, 0.88))
  textAt(canvas, 'LEARNING', 40, 104, 9, true, rgb(0.85, 0.9, 0.93))
  const left = band + 60
  const maxWidth = width - left - 60
  textAt(canvas, 'CERTIFICATE OF COMPLETION', left, height - 110, 12, true, TEAL)
  const nameSize = fitted(canvas, certificate.learnerName, 34, maxWidth)
  textAt(canvas, certificate.learnerName, left, height - 170, nameSize, true)
  textAt(canvas, 'has successfully completed', left, height - 200, 11, false, MUTED)
  const titleSize = fitted(canvas, certificate.courseTitle, 20, maxWidth)
  textAt(canvas, certificate.courseTitle, left, height - 236, titleSize, true, OCEAN)
  textAt(canvas, `Mentor: ${certificate.mentorName}`, left, height - 266, 10.5)
  const facts = [
    ['Completed', dateLabel(certificate.completedAt)],
    ['Issued', dateLabel(certificate.issuedAt)],
    ['Valid until', certificate.expiresAt ? dateLabel(certificate.expiresAt) : 'No expiry'],
  ]
  facts.forEach(([label, value], index) => {
    const x = left + index * 150
    textAt(canvas, label!.toUpperCase(), x, height - 320, 7.5, true, MUTED)
    textAt(canvas, value!, x, height - 336, 10, true)
  })
  signatureBlock(canvas, certificate, width - 160, 130)
  textAt(canvas, `Certificate No. ${certificateDisplayNumber(certificate)}`, left, 92, 9, true)
  textAt(canvas, `Verify: ${verificationUrl}`, left, 74, 8, false, OCEAN)
}

function drawFormal(canvas: Canvas, certificate: LearningCertificate, verificationUrl: string) {
  const { page, width, height } = canvas
  page.drawRectangle({ x: 18, y: 18, width: width - 36, height: height - 36, borderWidth: 3, borderColor: GOLD })
  page.drawRectangle({ x: 28, y: 28, width: width - 56, height: height - 56, borderWidth: 1.2, borderColor: NAVY })
  page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderWidth: 0.5, borderColor: GOLD })
  if (canvas.logo) drawImageFitted(canvas, canvas.logo, width / 2, height - 112, 140, 44)
  else centered(canvas, 'SEA N SHORE', height - 92, 13, true, NAVY)
  centered(canvas, 'Certificate of Completion', height - 160, 30, true, NAVY)
  page.drawLine({ start: { x: width / 2 - 120, y: height - 175 }, end: { x: width / 2 + 120, y: height - 175 }, thickness: 1, color: GOLD })
  centered(canvas, 'This is to certify that', height - 210, 11, false, MUTED)
  centered(canvas, certificate.learnerName, height - 250, 26, true, NAVY)
  centered(canvas, 'has satisfactorily completed the course', height - 280, 11, false, MUTED)
  centered(canvas, certificate.courseTitle, height - 316, 19, true, OCEAN)
  centered(canvas, `Delivered by ${certificate.mentorName}  ·  Completed ${dateLabel(certificate.completedAt)}`, height - 342, 9.5, false, MUTED)
  // The seal.
  page.drawCircle({ x: width - 140, y: 150, size: 40, color: GOLD, opacity: 0.9 })
  page.drawCircle({ x: width - 140, y: 150, size: 33, borderColor: rgb(1, 1, 1), borderWidth: 1 })
  textAt(canvas, 'VERIFIED', width - 140 - widthOf(canvas, 'VERIFIED', 8, true) / 2, 147, 8, true, rgb(1, 1, 1))
  signatureBlock(canvas, certificate, 230, 140)
  centered(canvas, `Certificate No. ${certificateDisplayNumber(certificate)}`, 96, 9, true)
  centered(canvas, [`Issued ${dateLabel(certificate.issuedAt)}`, validityLine(certificate)].filter(Boolean).join('  ·  '), 81, 8.5, false, MUTED)
  centered(canvas, `Verify: ${verificationUrl}`, 62, 8, false, OCEAN)
}

function drawMinimal(canvas: Canvas, certificate: LearningCertificate, verificationUrl: string) {
  const { page, width, height } = canvas
  const left = 90
  const maxWidth = width - left * 2
  if (canvas.logo) drawImageFitted(canvas, canvas.logo, left, height - 120, 120, 40, 'left')
  else textAt(canvas, 'Sea N Shore Learning', left, height - 100, 11, true, TEAL)
  textAt(canvas, 'Certificate of completion', left, height - 170, 13, false, MUTED)
  textAt(canvas, certificate.learnerName, left, height - 220, fitted(canvas, certificate.learnerName, 36, maxWidth), true)
  page.drawLine({ start: { x: left, y: height - 240 }, end: { x: left + 120, y: height - 240 }, thickness: 1.5, color: TEAL })
  textAt(canvas, certificate.courseTitle, left, height - 280, fitted(canvas, certificate.courseTitle, 18, maxWidth), true, NAVY)
  textAt(canvas, `${certificate.mentorName}  ·  Completed ${dateLabel(certificate.completedAt)}`, left, height - 304, 10, false, MUTED)
  signatureBlock(canvas, certificate, width - 180, 140)
  const footer = [`No. ${certificateDisplayNumber(certificate)}`, `Issued ${dateLabel(certificate.issuedAt)}`, validityLine(certificate)].filter(Boolean).join('   ')
  textAt(canvas, footer, left, 96, 8.5, false, MUTED)
  textAt(canvas, verificationUrl, left, 80, 8, false, OCEAN)
}

export async function buildLearningCertificatePdf({
  certificate,
  verificationUrl,
  images = {},
}: {
  certificate: LearningCertificate
  verificationUrl: string
  /** The course's logo and signature as copied onto this certificate (round B), already read from storage. */
  images?: { logo?: CertificateImage | null; signature?: CertificateImage | null }
}) {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([841.89, 595.28])
  const canvas: Canvas = {
    page,
    width: page.getWidth(),
    height: page.getHeight(),
    regular,
    bold,
    logo: await embedImage(pdf, images.logo),
    signature: await embedImage(pdf, images.signature),
  }

  pdf.setTitle(`${safeText(certificate.courseTitle)} - Certificate of Completion`)
  pdf.setSubject('Sea N Shore Certificate of Completion')
  pdf.setAuthor('Sea N Shore Global Shipping Community')
  pdf.setCreator('Sea N Shore Learning')

  switch (certificate.templateKey ?? null) {
    case null: drawOriginal(canvas, certificate, verificationUrl); break
    case 'classic': drawClassic(canvas, certificate, verificationUrl); break
    case 'modern': drawModern(canvas, certificate, verificationUrl); break
    case 'formal': drawFormal(canvas, certificate, verificationUrl); break
    case 'minimal': drawMinimal(canvas, certificate, verificationUrl); break
  }

  return pdf.save()
}
