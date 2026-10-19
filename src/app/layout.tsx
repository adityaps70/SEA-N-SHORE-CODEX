import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { connection } from 'next/server'
import { BRAND_ICONS } from '@/components/brand/brand-assets'
import { DisplayModeMarker } from '@/components/pwa/display-mode-marker'
import './globals.css'

/*
 * Self-hosted from the repo (src/app/fonts, SIL OFL 1.1), so a build never fetches from Google and the site makes no
 * request to Google at runtime. Inter is the body and UI face; Plus Jakarta Sans is the heading face.
 *
 * Each face comes in two files: latin (preloaded) and latin-ext (accented names such as Ł, Ş or ő; the browser fetches
 * it only when a page shows one of those characters). next/font applies `declarations` to every file in a call, so each
 * subset is its own call with its own unicode-range. globals.css joins each pair into --font-body and
 * --font-heading-face, which Tailwind's `font-sans` and `font-heading` use. Only the latin-ext call carries the
 * size-adjusted fallback face, so it comes last in the joined list. To try another heading face, change the two
 * heading calls below. next/font only reads literal values, so the two unicode ranges are written out in each call.
 */
const bodyLatin = localFont({
  src: './fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-body-latin',
  display: 'swap',
  adjustFontFallback: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
})
const bodyLatinExt = localFont({
  src: './fonts/inter-latin-ext-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-body-latin-ext',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF' }],
})
const headingLatin = localFont({
  src: [
    { path: './fonts/plus-jakarta-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/plus-jakarta-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-heading-latin',
  display: 'swap',
  adjustFontFallback: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
})
const headingLatinExt = localFont({
  src: [
    { path: './fonts/plus-jakarta-sans-latin-ext-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/plus-jakarta-sans-latin-ext-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-heading-latin-ext',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF' }],
})
const fontVariables = [bodyLatin, bodyLatinExt, headingLatin, headingLatinExt].map((font) => font.variable).join(' ')

function siteUrl() {
  try {
    return process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined
  } catch {
    return undefined
  }
}

const DESCRIPTION = 'The professional community for the global maritime industry.'

/** Phones: the page resizes above the on-screen keyboard so pinned composers stay visible. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: 'Sea N Shore', template: '%s | Sea N Shore' },
  description: DESCRIPTION,
  applicationName: 'Sea N Shore',
  manifest: BRAND_ICONS.manifest,
  // Round I (I3): the iPhone Home Screen app tags (mobile-web-app-capable, apple-mobile-web-app-title and status bar).
  appleWebApp: { capable: true, title: 'Sea N Shore', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: BRAND_ICONS.favicon, sizes: '48x48' },
      { url: BRAND_ICONS.icon32, sizes: '32x32', type: 'image/png' },
      { url: BRAND_ICONS.icon192, sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: BRAND_ICONS.apple, sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    siteName: 'Sea N Shore',
    type: 'website',
    images: [{ url: BRAND_ICONS.ogImage, width: 1200, height: 630, alt: 'Sea N Shore' }],
  },
  twitter: { card: 'summary_large_image', images: [BRAND_ICONS.ogImage] },
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // CSP: Next stamps the per-request nonce (src/proxy.ts) on its scripts only when a page renders per request, so
  // no page may be prerendered. Before this, the 404 page and /account-deleted were static and every visit to a
  // mistyped or probed URL reported our own scripts as blocked.
  await connection()
  return (
    <html lang="en" className={fontVariables}>
      <body>
        {children}
        <DisplayModeMarker />
      </body>
    </html>
  )
}
