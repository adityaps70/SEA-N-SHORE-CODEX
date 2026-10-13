'use client'

import { useState, useTransition } from 'react'
import { setRankingModeAction } from '../admin-actions'
import { RANKING_AREA_LABELS, RANKING_MODES, type RankingArea, type RankingMode } from '../switch-areas'

const MODE_LABELS: Record<RankingMode, string> = {
  off: 'Off (old behaviour)',
  admins: 'Admins only',
  everyone: 'Everyone',
}

/** One radio group per area. A change applies to the site within 30 seconds, with no deploy. */
export function RankingSwitches({ modes }: { modes: Record<RankingArea, RankingMode> }) {
  const [current, setCurrent] = useState(modes)
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()

  function change(area: RankingArea, mode: RankingMode) {
    const previous = current[area]
    setCurrent({ ...current, [area]: mode })
    setMessage('')
    startTransition(async () => {
      const result = await setRankingModeAction(area, mode)
      if (result.ok) {
        setMessage(`${RANKING_AREA_LABELS[area].title}: ${MODE_LABELS[mode]}. Applies within 30 seconds.`)
      } else {
        setCurrent((latest) => ({ ...latest, [area]: previous }))
        setMessage(result.error)
      }
    })
  }

  return (
    <div className="divide-y divide-mist-100">
      {(Object.keys(current) as RankingArea[]).map((area) => (
        <fieldset key={area} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between" disabled={pending}>
          <legend className="sr-only">{RANKING_AREA_LABELS[area].title}</legend>
          <div className="min-w-0">
            <p className="font-semibold text-navy-950">{RANKING_AREA_LABELS[area].title}</p>
            <p className="text-xs leading-5 text-muted">Off means: {RANKING_AREA_LABELS[area].off}</p>
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${RANKING_AREA_LABELS[area].title} switch`}>
            {RANKING_MODES.map((mode) => (
              <label
                key={mode}
                className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-mist-200 px-3 text-sm font-semibold text-navy-900 has-[:checked]:border-navy-950 has-[:checked]:bg-navy-950 has-[:checked]:text-white has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ocean-500"
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`ranking-${area}`}
                  value={mode}
                  checked={current[area] === mode}
                  onChange={() => change(area, mode)}
                />
                {MODE_LABELS[mode]}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <p role="status" aria-live="polite" className="px-4 py-3 text-sm text-muted empty:hidden">{message}</p>
    </div>
  )
}
