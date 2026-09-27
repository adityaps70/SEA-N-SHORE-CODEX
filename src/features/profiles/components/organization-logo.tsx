'use client'

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react'
import { Building2 } from 'lucide-react'
import { cn } from '@/lib/cn'

const sizes = {
  xs: { box: 'size-5 rounded', icon: 'size-3' },
  sm: { box: 'size-8 rounded-lg', icon: 'size-4' },
  md: { box: 'size-10 rounded-lg', icon: 'size-5' },
} as const

/**
 * Organization logo tile. Falls back to a Building2 tile when there is no logo or
 * the image cannot load (for example a signed-out visitor on a public profile).
 */
export function OrganizationLogo({
  logoUrl,
  size = 'sm',
  className,
}: {
  logoUrl: string | null | undefined
  size?: keyof typeof sizes
  className?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const dimensions = sizes[size]
  const showImage = Boolean(logoUrl) && failedUrl !== logoUrl

  return (
    <span
      aria-hidden="true"
      data-testid="organization-logo"
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden border border-mist-100 bg-mist-50 text-navy-900',
        dimensions.box,
        className,
      )}
    >
      {showImage && logoUrl ? (
        <img src={logoUrl} alt="" className="h-full w-full object-contain" onError={() => setFailedUrl(logoUrl)} />
      ) : (
        <Building2 className={dimensions.icon} />
      )}
    </span>
  )
}
