import type { Metadata } from 'next'
import { NewsletterLinkPage } from '@/features/newsletter/components/newsletter-link-page'

export const metadata: Metadata = { title: 'Confirm your newsletter subscription', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function NewsletterConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams
  return <NewsletterLinkPage kind="confirm" token={typeof token === 'string' ? token : null} />
}
