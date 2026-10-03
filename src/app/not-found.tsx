import { Wordmark } from '@/components/brand/wordmark'
import { NotFoundView } from '@/components/feedback/not-found-view'

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
