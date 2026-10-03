type AccountExportPayload = {
  schemaVersion: number
  generatedAt: string
  account: {
    profileId: string
    email: string | null
  }
  data: Record<string, unknown>
}

type ZipEntry = {
  name: string
  content: string
}

const UTF8_FLAG = 0x0800
const STORE_METHOD = 0
const ZIP_VERSION = 20
const MAX_UINT16 = 0xffff
const MAX_UINT32 = 0xffffffff

const textEncoder = new TextEncoder()

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[n] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosTimestamp(date: Date) {
  const safeYear = Math.max(1980, Math.min(2107, date.getUTCFullYear()))
  const dosDate = ((safeYear - 1980) << 9)
    | ((date.getUTCMonth() + 1) << 5)
    | date.getUTCDate()
  const dosTime = (date.getUTCHours() << 11)
    | (date.getUTCMinutes() << 5)
    | Math.floor(date.getUTCSeconds() / 2)

  return { dosDate, dosTime }
}

function createBuffer(length: number) {
  const bytes = new Uint8Array(length)
  return {
    bytes,
    view: new DataView(bytes.buffer),
  }
}

function concatenate(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }

  return result
}

function createZipArchive(entries: ZipEntry[], timestamp: Date) {
  if (entries.length > MAX_UINT16) {
    throw new Error('Too many account export files for ZIP format.')
  }

  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let localOffset = 0
  const { dosDate, dosTime } = dosTimestamp(timestamp)

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name)
    const dataBytes = textEncoder.encode(entry.content)

    if (
      nameBytes.byteLength > MAX_UINT16
      || dataBytes.byteLength > MAX_UINT32
      || localOffset > MAX_UINT32
    ) {
      throw new Error('Account export is too large for the ZIP format.')
    }

    const checksum = crc32(dataBytes)
    const local = createBuffer(30)
    local.view.setUint32(0, 0x04034b50, true)
    local.view.setUint16(4, ZIP_VERSION, true)
    local.view.setUint16(6, UTF8_FLAG, true)
    local.view.setUint16(8, STORE_METHOD, true)
    local.view.setUint16(10, dosTime, true)
    local.view.setUint16(12, dosDate, true)
    local.view.setUint32(14, checksum, true)
    local.view.setUint32(18, dataBytes.byteLength, true)
    local.view.setUint32(22, dataBytes.byteLength, true)
    local.view.setUint16(26, nameBytes.byteLength, true)
    local.view.setUint16(28, 0, true)

    localChunks.push(local.bytes, nameBytes, dataBytes)

    const central = createBuffer(46)
    central.view.setUint32(0, 0x02014b50, true)
    central.view.setUint16(4, ZIP_VERSION, true)
    central.view.setUint16(6, ZIP_VERSION, true)
    central.view.setUint16(8, UTF8_FLAG, true)
    central.view.setUint16(10, STORE_METHOD, true)
    central.view.setUint16(12, dosTime, true)
    central.view.setUint16(14, dosDate, true)
    central.view.setUint32(16, checksum, true)
    central.view.setUint32(20, dataBytes.byteLength, true)
    central.view.setUint32(24, dataBytes.byteLength, true)
    central.view.setUint16(28, nameBytes.byteLength, true)
    central.view.setUint16(30, 0, true)
    central.view.setUint16(32, 0, true)
    central.view.setUint16(34, 0, true)
    central.view.setUint16(36, 0, true)
    central.view.setUint32(38, 0, true)
    central.view.setUint32(42, localOffset, true)

    centralChunks.push(central.bytes, nameBytes)
    localOffset += local.bytes.byteLength + nameBytes.byteLength + dataBytes.byteLength
  }

  const centralDirectory = concatenate(centralChunks)
  if (localOffset + centralDirectory.byteLength > MAX_UINT32) {
    throw new Error('Account export is too large for the ZIP format.')
  }

  const end = createBuffer(22)
  end.view.setUint32(0, 0x06054b50, true)
  end.view.setUint16(4, 0, true)
  end.view.setUint16(6, 0, true)
  end.view.setUint16(8, entries.length, true)
  end.view.setUint16(10, entries.length, true)
  end.view.setUint32(12, centralDirectory.byteLength, true)
  end.view.setUint32(16, localOffset, true)
  end.view.setUint16(20, 0, true)

  return concatenate([...localChunks, centralDirectory, end.bytes])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  let text: string
  if (typeof value === 'object') {
    text = JSON.stringify(value)
  } else {
    text = String(value)
  }

  // Prevent spreadsheet formula execution while preserving the exact value in data.json.
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`
  }

  return `"${text.replaceAll('"', '""')}"`
}

function recordsToCsv(value: unknown): string | null {
  const rows = Array.isArray(value) ? value : [value]
  const presentRows = rows.filter((row) => row !== null && row !== undefined)

  if (presentRows.length === 0) {
    return null
  }

  if (!presentRows.every(isRecord)) {
    return ['"value"', ...presentRows.map(csvCell)].join('\r\n') + '\r\n'
  }

  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of presentRows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }

  if (columns.length === 0) {
    return null
  }

  const header = columns.map(csvCell).join(',')
  const body = presentRows.map((row) => (
    columns.map((column) => csvCell(row[column])).join(',')
  ))

  return '\ufeff' + [header, ...body].join('\r\n') + '\r\n'
}

function csvFileName(section: string) {
  const name = section
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return name || 'section'
}

function buildReadme(payload: AccountExportPayload) {
  return [
    'Sea N Shore - My Data Export',
    '================================',
    '',
    'This ZIP package is designed to be usable without technical tools.',
    '',
    'What is inside:',
    '- csv/ contains spreadsheet-friendly CSV files. Open them with Microsoft Excel, Apple Numbers, Google Sheets, or similar apps.',
    '- data.json contains the complete machine-readable export and preserves the exact account data structure.',
    '- README.txt is this guide.',
    '',
    'Some nested fields are stored as JSON text inside a CSV cell so they remain portable.',
    'CSV cells are protected against spreadsheet formula execution. The exact original value remains available in data.json.',
    '',
    `Generated: ${payload.generatedAt}`,
    `Account email: ${payload.account.email ?? 'Not available'}`,
    '',
    'Privacy notice:',
    'This archive may contain private account information, messages you sent, applications, and other personal activity.',
    'Store it securely and only share it when you intend to.',
    '',
  ].join('\r\n')
}

export function createAccountExportZip(payload: AccountExportPayload) {
  const entries: ZipEntry[] = [
    {
      name: 'README.txt',
      content: buildReadme(payload),
    },
    {
      name: 'data.json',
      content: JSON.stringify(payload, null, 2) + '\n',
    },
  ]

  const metadataCsv = recordsToCsv({
    schemaVersion: payload.schemaVersion,
    generatedAt: payload.generatedAt,
  })
  if (metadataCsv) {
    entries.push({ name: 'csv/export-metadata.csv', content: metadataCsv })
  }

  const accountCsv = recordsToCsv(payload.account)
  if (accountCsv) {
    entries.push({ name: 'csv/account.csv', content: accountCsv })
  }

  for (const [section, value] of Object.entries(payload.data)) {
    const csv = recordsToCsv(value)
    if (!csv) {
      continue
    }

    entries.push({
      name: `csv/${csvFileName(section)}.csv`,
      content: csv,
    })
  }

  const timestamp = new Date(payload.generatedAt)
  return createZipArchive(entries, Number.isNaN(timestamp.getTime()) ? new Date() : timestamp)
}

export type { AccountExportPayload }
