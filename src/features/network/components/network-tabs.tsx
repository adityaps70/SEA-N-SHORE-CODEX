import Link from 'next/link'
import { NETWORK_TABS, type NetworkTab } from '../types'

const labels: Record<NetworkTab, string> = {
  discover: 'Discover',
  connections: 'Connections',
  requests: 'Requests',
  following: 'Following',
}

export function NetworkTabs({ active, incomingRequestCount }: { active: NetworkTab; incomingRequestCount: number }) {
  return (
    <nav aria-label="My Network" className="mt-5 flex gap-2 overflow-x-auto rounded-2xl border border-mist-100 bg-white p-2 shadow-sm">
      {NETWORK_TABS.map((tab) => (
        <Link
          key={tab}
          href={`/network?tab=${tab}`}
          aria-current={active === tab ? 'page' : undefined}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-navy-900 hover:bg-mist-50 aria-[current=page]:bg-navy-950 aria-[current=page]:text-white"
        >
          {labels[tab]}
          {tab === 'requests' && incomingRequestCount > 0 ? (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-ocean-100 px-1.5 text-[11px] font-bold text-ocean-800 aria-[current=page]:bg-white/15 aria-[current=page]:text-white">
              {incomingRequestCount > 99 ? '99+' : incomingRequestCount}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}
