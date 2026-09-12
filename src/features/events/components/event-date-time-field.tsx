'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react'

type Props = {
  label: string
  name: string
  defaultValue?: string
  required?: boolean
  helper?: string
}

const weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function parts(value?: string) {
  if (!value) return { date: '', time: '' }
  const [date = '', rawTime = ''] = value.split('T')
  return { date, time: rawTime.slice(0, 5) }
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function readableDate(value: string) {
  if (!value) return 'Choose date'
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(dateFromKey(value))
}

function monthLabel(value: Date) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(value)
}

export function EventDateTimeField({ label, name, defaultValue = '', required = false, helper }: Props) {
  const initial = useMemo(() => parts(defaultValue), [defaultValue])
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => {
    const seed = initial.date ? dateFromKey(initial.date) : new Date()
    return new Date(seed.getFullYear(), seed.getMonth(), 1)
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const value = date && time ? `${date}T${time}` : ''

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1
    return day >= 1 && day <= daysInMonth ? day : null
  })
  const today = new Date()
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate())

  function chooseDate(day: number) {
    setDate(dateKey(year, month, day))
    setOpen(false)
  }

  function clearValue() {
    setDate('')
    setTime('')
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-semibold text-navy-900" htmlFor={`${name}-time`}>{label}{required ? <span className="ml-1 text-teal-700">*</span> : null}</label>
        {!required && value ? <button type="button" onClick={clearValue} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-navy-700"><X className="size-3.5" aria-hidden="true" />Clear</button> : null}
      </div>
      <input type="hidden" name={name} value={value} />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            className={`flex min-h-12 w-full items-center gap-3 rounded-2xl border bg-mist-50 px-4 text-left text-[15px] font-normal outline-none transition ${open ? 'border-teal-500' : 'border-mist-100 hover:border-mist-200'}`}
          >
            <CalendarDays className="size-4.5 shrink-0 text-teal-700" aria-hidden="true" />
            <span className={date ? 'text-navy-950' : 'text-slate-400'}>{readableDate(date)}</span>
          </button>
          {open ? (
            <div className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-[min(22rem,calc(100vw-3rem))] rounded-[1.5rem] border border-mist-100 bg-white p-4 shadow-xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <button type="button" onClick={() => setViewMonth(new Date(year, month - 1, 1))} className="grid size-9 place-items-center rounded-xl text-navy-700 hover:bg-mist-50" aria-label="Previous month"><ChevronLeft className="size-4.5" /></button>
                <p className="text-sm font-bold text-navy-950">{monthLabel(viewMonth)}</p>
                <button type="button" onClick={() => setViewMonth(new Date(year, month + 1, 1))} className="grid size-9 place-items-center rounded-xl text-navy-700 hover:bg-mist-50" aria-label="Next month"><ChevronRight className="size-4.5" /></button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {weekdays.map((weekday) => <span key={weekday} className="py-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{weekday}</span>)}
                {cells.map((day, index) => {
                  if (!day) return <span key={`empty-${index}`} className="aspect-square" />
                  const key = dateKey(year, month, day)
                  const selected = key === date
                  const isToday = key === todayKey
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => chooseDate(day)}
                      className={`aspect-square rounded-xl text-sm font-semibold transition ${selected ? 'bg-teal-600 text-white' : isToday ? 'border border-teal-300 text-teal-800 hover:bg-teal-50' : 'text-navy-800 hover:bg-mist-50'}`}
                    >
                      {day}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
        <div className="relative">
          <Clock3 className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-teal-700" aria-hidden="true" />
          <input
            id={`${name}-time`}
            type="time"
            value={time}
            required={required}
            onChange={(event) => setTime(event.target.value)}
            className="min-h-12 w-full rounded-2xl border border-mist-100 bg-mist-50 py-2 pl-10 pr-3 text-[15px] font-normal text-navy-950 outline-none transition focus:border-teal-500"
          />
        </div>
      </div>
      {helper ? <p className="text-xs font-normal leading-5 text-slate-400">{helper}</p> : null}
    </div>
  )
}
