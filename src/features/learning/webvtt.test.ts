import { describe, expect, it } from 'vitest'
import { formatTimestamp, parseWebVtt } from './webvtt'

describe('WebVTT captions for the transcript', () => {
  it('reads cue timings and plain text, skipping notes, styles and bad cues', () => {
    const vtt = '﻿WEBVTT - Inspection walkthrough\r\n\r\nNOTE written by the trainer\r\n\r\nSTYLE\r\n::cue { color: yellow }\r\n\r\n1\r\n00:00:01.000 --> 00:00:04.500 align:start\r\n<v Trainer>Welcome aboard.</v>\r\nLet&apos;s begin.\r\n\r\n00:05.000 --> 00:07.250\r\nCheck the <b>mooring</b> lines &amp; winches.\r\n\r\nbroken --> cue\r\nIgnored\r\n'
    expect(parseWebVtt(vtt)).toEqual([
      { start: 1, end: 4.5, text: "Welcome aboard. Let's begin." },
      { start: 5, end: 7.25, text: 'Check the mooring lines & winches.' },
    ])
  })

  it('returns nothing for a file that is not WebVTT', () => {
    expect(parseWebVtt('1\n00:00:01,000 --> 00:00:02,000\nAn SRT file')).toEqual([])
  })

  it('formats timestamps for the transcript', () => {
    expect(formatTimestamp(75)).toBe('1:15')
    expect(formatTimestamp(3725)).toBe('1:02:05')
    expect(formatTimestamp(-3)).toBe('0:00')
  })
})
