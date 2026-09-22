import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { readPdfPageCount } from './pdf-page-count'

describe('readPdfPageCount', () => {
  it('returns the exact PDF page count without rendering the document', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage()
    pdf.addPage()
    pdf.addPage()
    const bytes = await pdf.save()
    const file = new File([bytes], 'inspection-guide.pdf', { type: 'application/pdf' })

    await expect(readPdfPageCount(file)).resolves.toBe(3)
  })

  it('rejects invalid PDF bytes', async () => {
    const file = new File(['not-a-pdf'], 'broken.pdf', { type: 'application/pdf' })
    await expect(readPdfPageCount(file)).rejects.toThrow('feed_pdf_invalid')
  })
})
