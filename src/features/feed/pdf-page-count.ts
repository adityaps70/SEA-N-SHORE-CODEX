import { PDFDocument } from 'pdf-lib'

function readBlobAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('feed_pdf_read_failed'))
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result)
      else reject(new Error('feed_pdf_read_failed'))
    }
    reader.readAsArrayBuffer(file)
  })
}

export async function readPdfPageCount(file: File): Promise<number> {
  try {
    const bytes = await readBlobAsArrayBuffer(file)
    const pdf = await PDFDocument.load(bytes)
    return pdf.getPageCount()
  } catch {
    throw new Error('feed_pdf_invalid')
  }
}
