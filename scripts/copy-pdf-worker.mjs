import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const source = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')
const target = resolve('public/pdf.worker.min.mjs')

await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)
console.log('PDF_WORKER_READY=true')
