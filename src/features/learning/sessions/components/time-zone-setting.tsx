'use client'

import { useState, useTransition } from 'react'
import { Loader2, Save } from 'lucide-react'
import { saveTimeZoneAction } from '../time-zone-actions'
import { TimeZoneCombobox } from './time-zone-combobox'
import { timeZoneLabel } from '../time-zone-labels'
import { useDeviceTimeZone } from './local-session-time'

/** Settings (round D): the time zone used in live-session emails. Pages always use the device's own zone. */
export function TimeZoneSetting({ initialSource, initialZone }: { initialSource: 'auto' | 'manual'; initialZone: string | null }) {
  const device = useDeviceTimeZone()
  const [source, setSource] = useState(initialSource)
  const [zone, setZone] = useState(initialZone ?? 'Asia/Kolkata')
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setMessage(null)
    startTransition(async () => {
      const result = await saveTimeZoneAction(source, source === 'manual' ? zone : device)
      setMessage(result.ok ? { tone: 'success', text: 'Time zone saved.' } : { tone: 'error', text: result.error })
    })
  }

  return (
    <div>
      <p className="text-sm font-semibold text-navy-950">Time zone for live-session emails</p>
      <p className="mt-1 text-sm leading-6 text-muted">
        Session times on Sea N Shore always show in your device&rsquo;s time zone. Reminder emails use this one, and always add UTC.
      </p>
      <div className="mt-3 space-y-2">
        <label className="flex items-start gap-3 text-sm">
          <input type="radio" name="time-zone-source" checked={source === 'auto'} onChange={() => setSource('auto')} className="mt-1" />
          <span>
            <span className="font-semibold text-navy-950">Automatic</span>
            <span className="block text-muted">Follows the device you last used{device ? ` (now ${timeZoneLabel(device)})` : ''}.</span>
          </span>
        </label>
        <div className="flex items-start gap-3 text-sm">
          <input id="time-zone-manual" type="radio" name="time-zone-source" checked={source === 'manual'} onChange={() => setSource('manual')} className="mt-1" />
          <div className="min-w-0 flex-1">
            <label htmlFor="time-zone-manual" className="font-semibold text-navy-950">Always use</label>
            {/* Round H (H7): searchable, with "Kolkata, India (UTC+5:30)" labels; stores the IANA name. */}
            <TimeZoneCombobox
              className="mt-1.5"
              value={zone}
              onChange={(next) => { setZone(next); setSource('manual') }}
            />
          </div>
        </div>
      </div>
      <button type="button" onClick={save} disabled={pending} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white hover:bg-navy-900 disabled:opacity-60">
        {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
        Save time zone
      </button>
      {message ? <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-800'}`}>{message.text}</p> : null}
    </div>
  )
}
