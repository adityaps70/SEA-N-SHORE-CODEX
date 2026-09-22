type PdfPageSize = {
  width: number
  height: number
}

type PdfViewport = PdfPageSize

type PdfPage = {
  getViewport(input: { scale: number }): PdfViewport
  render(input: {
    canvas: HTMLCanvasElement
    canvasContext: CanvasRenderingContext2D
    viewport: PdfViewport
  }): { promise: Promise<void> }
}

type PdfDocument = {
  getPage(pageNumber: number): Promise<PdfPage>
}

let pdfJsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null
const documentCache = new Map<string, Promise<PdfDocument>>()

async function loadPdfJs() {
  pdfJsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
    return pdfjs
  })
  return pdfJsPromise
}

async function loadDocument(url: string): Promise<PdfDocument> {
  let cached = documentCache.get(url)
  if (!cached) {
    cached = loadPdfJs().then((pdfjs) => pdfjs.getDocument({
      url,
      withCredentials: true,
    }).promise as Promise<PdfDocument>)
    documentCache.set(url, cached)
  }
  return cached
}

export async function renderPdfPage(
  canvas: HTMLCanvasElement,
  url: string,
  pageNumber: number,
): Promise<PdfPageSize> {
  const document = await loadDocument(url)
  const page = await document.getPage(pageNumber)
  const baseViewport = page.getViewport({ scale: 1 })
  const context = canvas.getContext('2d', { alpha: false })

  if (!context || baseViewport.width <= 0 || baseViewport.height <= 0) {
    throw new Error('feed_document_render_unavailable')
  }

  const pixelRatio = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), 2)
  const cssTargetWidth = 1100
  const renderScale = (cssTargetWidth / baseViewport.width) * pixelRatio
  const viewport = page.getViewport({ scale: renderScale })

  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
  }).promise

  return {
    width: baseViewport.width,
    height: baseViewport.height,
  }
}
