import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { LearningCertificate } from './certificate-repository'

function safeText(value: string) {
  return value
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
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

export async function buildLearningCertificatePdf({
  certificate,
  verificationUrl,
}: {
  certificate: LearningCertificate
  verificationUrl: string
}) {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([841.89, 595.28])
  const width = page.getWidth()
  const height = page.getHeight()

  pdf.setTitle(`${safeText(certificate.courseTitle)} - Certificate of Completion`)
  pdf.setSubject('Sea N Shore Certificate of Completion')
  pdf.setAuthor('Sea N Shore Global Shipping Community')
  pdf.setCreator('Sea N Shore Learning')

  page.drawRectangle({
    x: 24,
    y: 24,
    width: width - 48,
    height: height - 48,
    borderWidth: 2,
    borderColor: rgb(0.05, 0.33, 0.42),
  })
  page.drawRectangle({
    x: 34,
    y: 34,
    width: width - 68,
    height: height - 68,
    borderWidth: 0.8,
    borderColor: rgb(0.73, 0.82, 0.84),
  })

  const centered = (text: string, y: number, size: number, useBold = false, color = rgb(0.04, 0.15, 0.22)) => {
    const font = useBold ? bold : regular
    const safe = safeText(text)
    const textWidth = font.widthOfTextAtSize(safe, size)
    page.drawText(safe, { x: (width - textWidth) / 2, y, size, font, color })
  }

  centered('SEA N SHORE', height - 90, 14, true, rgb(0.04, 0.42, 0.55))
  centered('GLOBAL SHIPPING COMMUNITY', height - 109, 9, true, rgb(0.35, 0.4, 0.44))
  centered('CERTIFICATE OF COMPLETION', height - 165, 28, true)
  centered('This certifies that', height - 208, 11, false, rgb(0.35, 0.4, 0.44))
  centered(certificate.learnerName, height - 252, 24, true, rgb(0.04, 0.42, 0.55))
  centered('has successfully completed', height - 286, 11, false, rgb(0.35, 0.4, 0.44))
  centered(certificate.courseTitle, height - 329, 20, true)
  centered(`Mentor: ${certificate.mentorName}`, height - 360, 11)
  centered(`Completed on ${dateLabel(certificate.completedAt)}`, height - 386, 10, false, rgb(0.35, 0.4, 0.44))

  page.drawLine({
    start: { x: 120, y: 150 },
    end: { x: width - 120, y: 150 },
    thickness: 0.7,
    color: rgb(0.73, 0.82, 0.84),
  })
  centered(`Certificate No. ${certificate.certificateNumber}`, 126, 9, true)
  centered(`Issued ${dateLabel(certificate.issuedAt)}`, 108, 8.5, false, rgb(0.35, 0.4, 0.44))
  centered(`Verify: ${verificationUrl}`, 82, 8, false, rgb(0.04, 0.42, 0.55))

  return pdf.save()
}
