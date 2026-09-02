import { PublicHeader } from '@/components/navigation/public-header'

export default function PublicProfileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-mist-50">
      <PublicHeader />
      {children}
    </div>
  )
}
