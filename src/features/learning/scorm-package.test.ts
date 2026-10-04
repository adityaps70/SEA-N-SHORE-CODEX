import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseScormPackage } from './scorm-package'

function storedZip(entries: Array<{ name: string; body: string }>) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const body = Buffer.from(entry.body)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }

  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBytes, eocd])
}

/** One deflated entry whose headers declare `declaredSize` bytes, whatever it really inflates to. */
function deflatedZip(name: string, content: Buffer, declaredSize: number) {
  const nameBytes = Buffer.from(name)
  const data = deflateRawSync(content)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(declaredSize, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(declaredSize, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt32LE(0, 42)
  const centralBytes = Buffer.concat([central, nameBytes])
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(local.length + nameBytes.length + data.length, 16)
  return Buffer.concat([local, nameBytes, data, centralBytes, eocd])
}

describe('parseScormPackage', () => {
  it('parses a SCORM 1.2 package and resolves the launch resource', () => {
    const manifest = `<?xml version="1.0"?>
      <manifest identifier="sns" version="1.0">
        <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
        <organizations default="ORG"><organization identifier="ORG"><item identifier="ITEM" identifierref="RES"/></organization></organizations>
        <resources><resource identifier="RES" type="webcontent" adlcp:scormtype="sco" href="player/index.html"/></resources>
      </manifest>`
    const parsed = parseScormPackage(storedZip([
      { name: 'imsmanifest.xml', body: manifest },
      { name: 'player/index.html', body: '<html>training</html>' },
    ]))

    expect(parsed.version).toBe('1.2')
    expect(parsed.launchPath).toBe('player/index.html')
    expect(parsed.files.map((entry) => entry.path)).toContain('imsmanifest.xml')
  })

  it('parses SCORM 2004 packages', () => {
    const manifest = `<?xml version="1.0"?>
      <manifest identifier="sns">
        <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
        <resources><resource identifier="R1" type="webcontent" href="launch.html"/></resources>
      </manifest>`
    const parsed = parseScormPackage(storedZip([
      { name: 'imsmanifest.xml', body: manifest },
      { name: 'launch.html', body: '<html>2004</html>' },
    ]))
    expect(parsed.version).toBe('2004')
    expect(parsed.launchPath).toBe('launch.html')
  })

  it('rejects zip-slip paths before extraction', () => {
    expect(() => parseScormPackage(storedZip([
      { name: 'imsmanifest.xml', body: '<manifest />' },
      { name: '../evil.html', body: 'bad' },
    ]))).toThrow('scorm_zip_path_invalid')
  })

  it('stops inflating an entry at its declared size (Round 14, 2.3)', () => {
    const bomb = deflatedZip('imsmanifest.xml', Buffer.alloc(1024 * 1024), 10)
    expect(() => parseScormPackage(bomb)).toThrow('scorm_zip_size_mismatch')
    const honest = deflatedZip('index.html', Buffer.from('<html>ok</html>'), 15)
    expect(() => parseScormPackage(honest)).toThrow('scorm_manifest_missing')
  })

  it('requires imsmanifest.xml and a valid launch resource', () => {
    expect(() => parseScormPackage(storedZip([{ name: 'index.html', body: 'x' }])))
      .toThrow('scorm_manifest_missing')
  })
})
