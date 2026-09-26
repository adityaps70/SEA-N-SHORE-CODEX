import type { Metadata } from 'next'
import { NewsletterLinkPage } from '@/features/newsletter/components/newsletter-link-page'

export const metadata: Metadata = { title: 'Unsubscribe from the newsletter', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function NewsletterUnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams
  return <NewsletterLinkPage kind="unsubscribe" token={typeof token === 'string' ? token : null} />
}
