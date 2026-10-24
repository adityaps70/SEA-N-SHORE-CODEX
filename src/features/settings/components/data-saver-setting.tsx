'use client'

import { Gauge } from 'lucide-react'
import { setDataSaverChosen, useDataSaver } from '@/lib/browser/data-saver'

/**
 * Round P3: the Data saver switch (this device only). On: videos load nothing until you play them
 * and never start by themselves. Video already never autoplays on mobile data.
 */
export function DataSaverSetting() {
  const on = useDataSaver()
  return (
    <section aria-labelledby="data-saver-title" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:rounded-none max-md:border-x-0 max-md:shadow-none sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
          <Gauge aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span id="data-saver-title" className="text-lg font-semibold text-navy-950">Data saver</span>
            <span className="relative inline-flex">
              <input
                type="checkbox"
                role="switch"
                checked={on}
                onChange={(event) => setDataSaverChosen(event.target.checked)}
                aria-describedby="data-saver-description"
                className="peer sr-only"
              />
              <span aria-hidden="true" className="h-7 w-12 rounded-full bg-mist-300 transition peer-checked:bg-ocean-700 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ocean-500" />
              <span aria-hidden="true" className="absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
            </span>
          </label>
          <p id="data-saver-description" className="mt-1 text-sm leading-6 text-muted">
            Videos load only when you press play and never start by themselves. Applies to this device. Videos never start by themselves on mobile data.
          </p>
        </div>
      </div>
    </section>
  )
}
