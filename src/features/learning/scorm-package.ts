import { inflateRawSync } from 'node:zlib'
import { posix as path } from 'node:path'

export type ScormPackageVersion = '1.2' | '2004'

export type ScormPackageFile = {
  path: string
  body: Buffer
  mimeType: string
}

export type ParsedScormPackage = {
  version: ScormPackageVersion
  manifestPath: 'imsmanifest.xml'
  launchPath: string
  files: ScormPackageFile[]
  manifestMetadata: {
    schemaVersion: string
    fileCount: number
    totalUncompressedBytes: number
  }
}

const MAX_FILES = 5000
const MAX_FILE_BYTES = 100 * 1024 * 1024
const MAX_TOTAL_BYTES = 500 * 1024 * 1024
const MAX_ZIP_BYTES = 200 * 1024 * 1024
const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

function contentTypeFor(filename: string) {
  const extension = path.extname(filename).toLowerCase()
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  }
  return types[extension] ?? 'application/octet-stream'
}

function normalizePackagePath(value: string) {
  if (!value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error('scorm_zip_path_invalid')
  }
  const normalized = path.normalize(value)
  if (
    normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || path.isAbsolute(normalized)
    || normalized.includes('/../')
  ) throw new Error('scorm_zip_path_invalid')
  return normalized.replace(/^\.\//, '')
}

function findEocd(buffer: Buffer) {
  const minimum = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  throw new Error('scorm_zip_invalid')
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

function detectVersion(manifest: string): { version: ScormPackageVersion; schemaVersion: string } {
  const match = /<schemaversion\b[^>]*>\s*([^<]+?)\s*<\/schemaversion>/i.exec(manifest)
  const schemaVersion = match?.[1]?.trim() ?? ''
  if (/2004/i.test(schemaVersion) || /adlcp_v1p3|imsss/i.test(manifest)) {
    return { version: '2004', schemaVersion: schemaVersion || '2004' }
  }
  if (/1\.2/i.test(schemaVersion) || /adlcp_rootv1p2|adlcp_v1p2/i.test(manifest)) {
    return { version: '1.2', schemaVersion: schemaVersion || '1.2' }
  }
  throw new Error('scorm_version_unsupported')
}

function resolveLaunchPath(manifest: string, files: ScormPackageFile[]) {
  const resourceTags = manifest.match(/<resource\b[^>]*>/gi) ?? []
  const candidates = resourceTags
    .map((tag) => {
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
      if (!href) return null
      const scormType = /\b(?:adlcp:)?scormtype\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
      return { href: decodeXmlEntities(href), preferred: scormType === 'sco' }
    })
    .filter((entry): entry is { href: string; preferred: boolean } => entry !== null)
    .sort((a, b) => Number(b.preferred) - Number(a.preferred))

  const fileSet = new Set(files.map((file) => file.path))
  for (const candidate of candidates) {
    const hrefWithoutFragment = candidate.href.split('#', 1)[0]!.split('?', 1)[0]!
    let decoded = hrefWithoutFragment
    try { decoded = decodeURIComponent(hrefWithoutFragment) } catch { /* keep literal path */ }
    const normalized = normalizePackagePath(decoded)
    if (fileSet.has(normalized)) return normalized
  }
  throw new Error('scorm_launch_missing')
}

export function parseScormPackage(input: Uint8Array | Buffer): ParsedScormPackage {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buffer.length === 0 || buffer.length > MAX_ZIP_BYTES) throw new Error('scorm_zip_invalid')

  const eocd = findEocd(buffer)
  const diskNumber = buffer.readUInt16LE(eocd + 4)
  const centralDisk = buffer.readUInt16LE(eocd + 6)
  const entries = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (diskNumber !== 0 || centralDisk !== 0 || entries === 0 || entries > MAX_FILES) throw new Error('scorm_zip_invalid')
  if (centralOffset + centralSize > eocd || centralOffset < 0) throw new Error('scorm_zip_invalid')

  const files: ScormPackageFile[] = []
  let totalBytes = 0
  let cursor = centralOffset

  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('scorm_zip_invalid')
    }
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const externalAttributes = buffer.readUInt32LE(cursor + 38)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const nameStart = cursor + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd + extraLength + commentLength > buffer.length) throw new Error('scorm_zip_invalid')
    if ((flags & 0x1) !== 0) throw new Error('scorm_zip_encrypted')
    if (method !== 0 && method !== 8) throw new Error('scorm_zip_compression_unsupported')

    const rawName = buffer.toString('utf8', nameStart, nameEnd)
    const unixMode = externalAttributes >>> 16
    if ((unixMode & 0o170000) === 0o120000) throw new Error('scorm_zip_symlink_forbidden')
    cursor = nameEnd + extraLength + commentLength
    if (rawName.endsWith('/')) continue

    const safePath = normalizePackagePath(rawName)
    if (uncompressedSize > MAX_FILE_BYTES) throw new Error('scorm_zip_file_too_large')
    totalBytes += uncompressedSize
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('scorm_zip_too_large')
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error('scorm_zip_invalid')
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) throw new Error('scorm_zip_invalid')
    const compressed = buffer.subarray(dataStart, dataEnd)
    const body = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed)
    if (body.length !== uncompressedSize) throw new Error('scorm_zip_size_mismatch')
    files.push({ path: safePath, body, mimeType: contentTypeFor(safePath) })
  }

  const manifestFile = files.find((file) => file.path.toLowerCase() === 'imsmanifest.xml')
  if (!manifestFile) throw new Error('scorm_manifest_missing')
  const manifest = manifestFile.body.toString('utf8')
  const detected = detectVersion(manifest)
  const launchPath = resolveLaunchPath(manifest, files)

  return {
    version: detected.version,
    manifestPath: 'imsmanifest.xml',
    launchPath,
    files,
    manifestMetadata: {
      schemaVersion: detected.schemaVersion,
      fileCount: files.length,
      totalUncompressedBytes: totalBytes,
    },
  }
}
