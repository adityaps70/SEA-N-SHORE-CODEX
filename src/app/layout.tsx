import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { BRAND_ICONS } from '@/components/brand/brand-assets'
import './globals.css'

/*
 * Self-hosted from the repo (src/app/fonts, latin subset, SIL OFL 1.1), so a build never fetches from Google and
 * the site makes no request to Google at runtime. Inter is the body and UI face; Plus Jakarta Sans is the heading
 * face. Both are exposed as CSS variables and mapped to Tailwind's `font-sans` and `font-heading` in globals.css.
 * To try another heading face, change only `headingFont` below.
 */
const bodyFont = localFont({
  src: './fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-body',
  display: 'swap',
})
const headingFont = localFont({
  src: [
    { path: './fonts/plus-jakarta-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/plus-jakarta-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-heading-face',
  display: 'swap',
})

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${headingFont.variable}`}>
      <body>{children}</body>
    </html>
  )
}
