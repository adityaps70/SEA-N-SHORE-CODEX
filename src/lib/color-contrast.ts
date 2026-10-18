/**
 * Round H (H8): WCAG 2.1 contrast maths for the colour tokens (src/app/globals.css) and their tests.
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

/** "#0b2740" or "#fff" to [r, g, b] in 0–255. Throws on anything else. */
export function parseHexColor(hex: string): [number, number, number] {
  const value = hex.trim().replace(/^#/, '')
  const full = value.length === 3 ? value.split('').map((digit) => digit + digit).join('') : value
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Not a hex colour: ${hex}`)
  return [0, 2, 4].map((start) => parseInt(full.slice(start, start + 2), 16)) as [number, number, number]
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexColor(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two colours, 1 to 21, in either order. */
export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG AA minimums: 4.5:1 for body text, 3:1 for large text, UI component boundaries and focus indicators. */
export const AA_TEXT = 4.5
export const AA_LARGE_TEXT_AND_UI = 3
