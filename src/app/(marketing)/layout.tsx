import { PublicFooter } from '@/components/navigation/public-footer'
import { PublicHeader } from '@/components/navigation/public-header'
import { MarketingChrome } from './marketing-chrome'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketingChrome header={<PublicHeader />} footer={<PublicFooter />}>
      {children}
    </MarketingChrome>
  )
}
