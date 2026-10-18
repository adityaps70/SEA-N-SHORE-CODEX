import { NOT_FOUND_METADATA, NotFoundView } from '@/components/feedback/not-found-view'

// Round H (H5): "Page not found · Sea N Shore", noindex.
export const metadata = NOT_FOUND_METADATA

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
