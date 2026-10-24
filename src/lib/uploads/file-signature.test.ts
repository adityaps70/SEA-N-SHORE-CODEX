import { describe, expect, it } from 'vitest'
import { matchesFileSignature } from './file-signature'

const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)

describe('matchesFileSignature (Round P3)', () => {
  it('recognises each supported type from its first bytes', () => {
    expect(matchesFileSignature('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true)
    expect(matchesFileSignature('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true)
    expect(matchesFileSignature('image/webp', text('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe(true)
    expect(matchesFileSignature('video/mp4', bytes(0, 0, 0, 0x18, ...text('ftypisom')))).toBe(true)
    expect(matchesFileSignature('audio/x-m4a', bytes(0, 0, 0, 0x20, ...text('ftypM4A ')))).toBe(true)
    expect(matchesFileSignature('video/webm', bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe(true)
    expect(matchesFileSignature('audio/mpeg', text('ID3\u0004'))).toBe(true)
    expect(matchesFileSignature('audio/mpeg', bytes(0xff, 0xfb, 0x90, 0x00))).toBe(true)
    expect(matchesFileSignature('audio/wav', text('RIFF\u0000\u0000\u0000\u0000WAVEfmt '))).toBe(true)
    expect(matchesFileSignature('application/pdf', text('%PDF-1.7\n'))).toBe(true)
    expect(matchesFileSignature('application/zip', bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true)
    expect(matchesFileSignature('application/msword', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe(true)
    expect(matchesFileSignature('text/vtt', text('﻿WEBVTT\n\n00:00.000 --> 00:01.000\nHello'))).toBe(true)
  })

  it('refuses a renamed file: a JPEG declared as a PDF (the CV case), a ZIP declared as a video, unknown types', () => {
    expect(matchesFileSignature('application/pdf', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(false)
    expect(matchesFileSignature('video/mp4', bytes(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0))).toBe(false)
    expect(matchesFileSignature('image/png', text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(false)
    expect(matchesFileSignature('text/plain', bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false)
    expect(matchesFileSignature('text/vtt', text('1\n00:00:00,000 --> 00:00:01,000\n'))).toBe(false)
    expect(matchesFileSignature('application/x-msdownload', bytes(0x4d, 0x5a))).toBe(false)
  })
})
