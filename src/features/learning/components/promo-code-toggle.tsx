'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { setPromoCodeDisabled } from '../promo-code-actions'

/** Stop or restart a promo code. Uses already redeemed stay counted. */
export function PromoCodeToggle({ codeId, disabled }: { codeId: string; disabled: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          setError(null)
          const result = await setPromoCodeDisabled(codeId, !disabled)
          if (!result.ok) setError(result.error)
          else router.refresh()
        })}
        className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 px-3 text-sm font-bold text-navy-950 hover:bg-mist-50 disabled:opacity-60"
      >
        {disabled ? 'Turn on' : 'Turn off'}
      </button>
      {error ? <p role="alert" className="mt-1 text-xs text-rose-700">{error}</p> : null}
    </div>
  )
}
