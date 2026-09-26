import { NotFoundView } from '@/components/feedback/not-found-view'

export default function MarketingNotFound() {
  return (
    <NotFoundView
      title="This page is not on the chart."
      body="The link may be out of date or mistyped. Continue from the home page or read about the newsletter."
      primary={{ href: '/', label: 'Go to the home page' }}
      links={[{ href: '/newsletter', label: 'Newsletter' }]}
    />
  )
}
