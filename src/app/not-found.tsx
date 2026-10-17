import { Wordmark } from '@/components/brand/wordmark'
import { NOT_FOUND_METADATA, NotFoundView } from '@/components/feedback/not-found-view'

// Round H (H5): "Page not found · Sea N Shore", noindex.
export const metadata = NOT_FOUND_METADATA

export default function NotFound() {
  return (
    <NotFoundView
      fullScreen
      title="This page is not on the chart."
      body="The link may be out of date, mistyped, or the page may have been removed. Check the address, or continue from one of these pages."
      primary={{ href: '/home', label: 'Go to Home' }}
      links={[
        { href: '/search', label: 'Search' },
        { href: '/help', label: 'Get help' },
      ]}
    >
      <Wordmark />
    </NotFoundView>
  )
}
