import { PDFDocument } from 'pdf-lib'

export async function readPdfPageCount(file: File): Promise<number> {
  try {
    const bytes = await file.arrayBuffer()
    const pdf = await PDFDocument.load(bytes)
    return pdf.getPageCount()
  } catch {
    throw new Error('feed_pdf_invalid')
  }
}
