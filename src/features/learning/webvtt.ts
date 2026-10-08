/** A caption cue for the transcript panel (learning round A, A7). */
export type CaptionCue = { start: number; end: number; text: string }

function seconds(stamp: string) {
  const parts = stamp.trim().split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const [h, m, s] = parts.length === 3 ? parts : ['0', ...parts]
  const value = Number(h) * 3600 + Number(m) * 60 + Number(String(s).replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

/**
 * Reads the cues of a WebVTT file: timings and plain text (voice and style tags removed). Notes,
 * styles and regions are skipped; a malformed cue is ignored rather than failing the whole file.
 */
export function parseWebVtt(source: string): CaptionCue[] {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (!text.startsWith('WEBVTT')) return []
  const cues: CaptionCue[] = []
  for (const block of text.split(/\n{2,}/).slice(1)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0] ?? '')) continue
    const [rawStart, rest] = lines[timingIndex]!.split('-->')
    const start = seconds(rawStart ?? '')
    const end = seconds((rest ?? '').trim().split(/\s+/)[0] ?? '')
    if (start === null || end === null || end < start) continue
    const cueText = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    if (cueText) cues.push({ start, end, text: cueText })
  }
  return cues
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatTimestamp(totalSeconds: number) {
  const whole = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = String(whole % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
