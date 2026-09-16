'use client'

import { useEffect, useState } from 'react'
import { checkUsernameAvailability } from '../username-actions'
import { normalizeUsername, usernameSchema } from '../username'

type UsernameStatus = 'idle' | 'checking' | 'available' | 'current' | 'taken' | 'invalid' | 'error'

type UsernameFieldProps = {
  initialValue?: string
  currentUsername?: string
  serverError?: string
  changesRemaining?: number
  locked?: boolean
  onReadyChange?: (ready: boolean) => void
}

export function UsernameField({
  initialValue = '',
  currentUsername,
  serverError,
  changesRemaining,
  locked = false,
  onReadyChange,
}: UsernameFieldProps) {
  const normalizedInitial = normalizeUsername(initialValue)
  const normalizedCurrent = currentUsername ? normalizeUsername(currentUsername) : ''
  const [value, setValue] = useState(normalizedInitial)
  const [status, setStatus] = useState<UsernameStatus>(normalizedCurrent && normalizedInitial === normalizedCurrent ? 'current' : 'idle')
  const [message, setMessage] = useState(serverError ?? '')

  useEffect(() => {
    if (locked) {
      setStatus('current')
      setMessage('Your username is locked because both username changes have been used.')
      onReadyChange?.(true)
      return
    }

    const parsed = usernameSchema.safeParse(value)
    if (!parsed.success) {
      setStatus(value ? 'invalid' : 'idle')
      setMessage(value ? (parsed.error.issues[0]?.message ?? 'Choose a valid username.') : '')
      onReadyChange?.(false)
      return
    }

    if (normalizedCurrent && parsed.data === normalizedCurrent) {
      setStatus('current')
      setMessage(serverError ?? 'This is your current username.')
      onReadyChange?.(true)
      return
    }

    setStatus('checking')
    setMessage('Checking username…')
    onReadyChange?.(false)

    let active = true
    const timer = setTimeout(() => {
      void checkUsernameAvailability(parsed.data)
        .then((result) => {
          if (!active) return
          if ('valid' in result && result.valid === false) {
            setStatus('invalid')
            setMessage(result.message)
            onReadyChange?.(false)
          } else if (result.current) {
            setStatus('current')
            setMessage('This is your current username.')
            onReadyChange?.(true)
          } else if (result.available) {
            setStatus('available')
            setMessage('Username is available.')
            onReadyChange?.(true)
          } else {
            setStatus('taken')
            setMessage('That username is already taken.')
            onReadyChange?.(false)
          }
        })
        .catch(() => {
          if (!active) return
          setStatus('error')
          setMessage('We could not check this username. Please try again.')
          onReadyChange?.(false)
        })
    }, 400)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [locked, normalizedCurrent, onReadyChange, serverError, value])

  const invalid = status === 'taken' || status === 'invalid' || status === 'error'
  const positive = status === 'available' || status === 'current'

  return (
    <label className="grid gap-2 text-sm font-medium text-navy-900">
      Username
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted">@</span>
        <input
          name="slug"
          value={value}
          onChange={(event) => setValue(normalizeUsername(event.target.value))}
          readOnly={locked}
          maxLength={30}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby="username-description"
          className="min-h-12 w-full rounded-xl border border-mist-100 bg-white py-2 pl-8 pr-4 text-base text-ink shadow-sm placeholder:text-muted focus:border-ocean-700 read-only:bg-mist-50 read-only:text-muted"
          placeholder="capt.saurabh"
          required
        />
      </div>
      <span id="username-description" className={invalid ? 'text-red-700' : positive ? 'text-emerald-700' : 'text-muted'}>
        {message || '3–30 characters. Use letters, numbers, dots, underscores, or hyphens.'}
      </span>
      {changesRemaining !== undefined ? (
        <span className="text-xs font-normal text-muted">Username changes remaining: {changesRemaining} of 2.</span>
      ) : null}
    </label>
  )
}
