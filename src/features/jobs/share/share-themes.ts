import type { ShareBadge, ShareLook } from './share-options'

/**
 * Round I (I1): the five looks of the job share image and the four badge colours. Every text colour passes WCAG AA
 * (4.5:1) on every background it is drawn on, including both ends of a gradient (share-themes.test checks each
 * pair), so small chip and footer text stays readable.
 */
export type ShareTheme = {
  name: string
  /** Top and bottom of the background gradient. */
  background: readonly [string, string]
  text: string
  muted: string
  /** A thin rule and the logo tile ring; never text. */
  accent: string
  chipBackground: string
  chipText: string
  chipBorder: string
  panelBackground: string
  panelText: string
  panelMuted: string
  footerBackground: string
  footerText: string
  footerMuted: string
}

export const SHARE_THEMES: Record<ShareLook, ShareTheme> = {
  sky: {
    name: 'Light sky',
    background: ['#e3f1fa', '#f7fbfe'],
    text: '#071b2d',
    muted: '#2c4a63',
    accent: '#0b6e99',
    chipBackground: '#ffffff',
    chipText: '#071b2d',
    chipBorder: '#b6d8ec',
    panelBackground: '#ffffff',
    panelText: '#071b2d',
    panelMuted: '#3d5a73',
    footerBackground: '#071b2d',
    footerText: '#ffffff',
    footerMuted: '#c5d9ea',
  },
  navy: {
    name: 'Navy',
    background: ['#0e3354', '#071b2d'],
    text: '#ffffff',
    muted: '#c5d9ea',
    accent: '#7cc8f0',
    chipBackground: '#163d60',
    chipText: '#ffffff',
    chipBorder: '#2a5a82',
    panelBackground: '#0b2a45',
    panelText: '#ffffff',
    panelMuted: '#b9cfe2',
    footerBackground: '#04111d',
    footerText: '#ffffff',
    footerMuted: '#b9cfe2',
  },
  teal: {
    name: 'Teal',
    background: ['#0f6b70', '#0a4a4f'],
    text: '#ffffff',
    muted: '#d4f1ef',
    accent: '#8ee3da',
    chipBackground: '#0c5a5f',
    chipText: '#ffffff',
    chipBorder: '#2b8a8f',
    panelBackground: '#083d41',
    panelText: '#ffffff',
    panelMuted: '#c4ebe7',
    footerBackground: '#052b2e',
    footerText: '#ffffff',
    footerMuted: '#c4ebe7',
  },
  midnight: {
    name: 'Midnight',
    background: ['#161c30', '#0a0d17'],
    text: '#f5f7fb',
    muted: '#b9c3da',
    accent: '#f4b942',
    chipBackground: '#232b45',
    chipText: '#f5f7fb',
    chipBorder: '#36406a',
    panelBackground: '#121829',
    panelText: '#f5f7fb',
    panelMuted: '#b9c3da',
    footerBackground: '#05070d',
    footerText: '#f5f7fb',
    footerMuted: '#b9c3da',
  },
  white: {
    name: 'Minimal white',
    background: ['#ffffff', '#ffffff'],
    text: '#111827',
    muted: '#4b5563',
    accent: '#0b6e99',
    chipBackground: '#f3f4f6',
    chipText: '#111827',
    chipBorder: '#e5e7eb',
    panelBackground: '#f9fafb',
    panelText: '#111827',
    panelMuted: '#4b5563',
    footerBackground: '#111827',
    footerText: '#ffffff',
    footerMuted: '#d1d5db',
  },
}

export const SHARE_BADGES: Record<ShareBadge, { name: string; background: string; text: string }> = {
  coral: { name: 'Coral', background: '#c2410c', text: '#ffffff' },
  amber: { name: 'Amber', background: '#f59e0b', text: '#1c1300' },
  emerald: { name: 'Emerald', background: '#047857', text: '#ffffff' },
  ocean: { name: 'Ocean', background: '#0369a1', text: '#ffffff' },
}

function channel(value: number) {
  const scaled = value / 255
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of a #rrggbb colour. */
export function relativeLuminance(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255)
}

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/** Every text colour with the backgrounds it is drawn on, for the AA check. */
export function themeTextPairs(theme: ShareTheme): Array<{ text: string; on: string; role: string }> {
  return [
    ...theme.background.flatMap((on) => [
      { text: theme.text, on, role: 'title and company' },
      { text: theme.muted, on, role: 'labels' },
    ]),
    { text: theme.chipText, on: theme.chipBackground, role: 'chips' },
    { text: theme.panelText, on: theme.panelBackground, role: 'job details' },
    { text: theme.panelMuted, on: theme.panelBackground, role: 'job details labels' },
    { text: theme.footerText, on: theme.footerBackground, role: 'footer' },
    { text: theme.footerMuted, on: theme.footerBackground, role: 'footer small text' },
  ]
}
