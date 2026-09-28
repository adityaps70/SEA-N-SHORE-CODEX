import type { Metadata } from 'next'
import { BRAND_ICONS } from '@/components/brand/brand-assets'
import './globals.css'

function siteUrl() {
  try {
    return process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined
  } catch {
    return undefined
  }
}

const DESCRIPTION = 'The professional community for the global maritime industry.'

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
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
