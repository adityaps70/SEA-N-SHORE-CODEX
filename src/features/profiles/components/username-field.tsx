'use client'

import { useEffect, useState } from 'react'
import { checkUsernameAvailability } from '../username-actions'
import { normalizeUsername, usernameSchema } from '../username'

type UsernameStatus = 'idle' | 'checking' | 'available' | 'current' | 'taken' | 'invalid' | 'error'

type RemoteUsernameState = {
  username: string
  status: Exclude<UsernameStatus, 'idle' | 'checking'>
  message: string
  ready: boolean
}

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
  const [serverErrorActive, setServerErrorActive] = useState(Boolean(serverError))
  const [remoteState, setRemoteState] = useState<RemoteUsernameState | null>(null)
  const parsed = usernameSchema.safeParse(value)
  const candidate = parsed.success ? parsed.data : ''
  const isCurrent = Boolean(normalizedCurrent && candidate === normalizedCurrent)
  const shouldCheck = !locked && parsed.success && !isCurrent && !serverErrorActive
  const matchingRemoteState = shouldCheck && remoteState?.username === candidate ? remoteState : null

  let status: UsernameStatus
  let message: string
  let ready: boolean

  if (locked) {
    status = 'current'
    message = 'Your username is locked because both username changes have been used.'
    ready = true
  } else if (serverErrorActive && serverError) {
    status = 'invalid'
    message = serverError
    ready = false
  } else if (!parsed.success) {
    status = value ? 'invalid' : 'idle'
    message = value ? (parsed.error.issues[0]?.message ?? 'Choose a valid username.') : ''
    ready = false
  } else if (isCurrent) {
    status = 'current'
    message = serverError ?? 'This is your current username.'
    ready = true
  } else if (matchingRemoteState) {
    status = matchingRemoteState.status
    message = matchingRemoteState.message
    ready = matchingRemoteState.ready
  } else {
    status = 'checking'
    message = serverError ?? 'Checking username…'
    ready = false
  }

  useEffect(() => {
    onReadyChange?.(ready)
  }, [onReadyChange, ready])

  useEffect(() => {
    if (!shouldCheck) return

    let active = true
    const username = candidate
    const timer = setTimeout(() => {
      void checkUsernameAvailability(username)
        .then((result) => {
          if (!active) return
          if ('valid' in result && result.valid === false) {
            setRemoteState({ username, status: 'invalid', message: result.message, ready: false })
          } else if (result.current) {
            setRemoteState({ username, status: 'current', message: 'This is your current username.', ready: true })
          } else if (result.available) {
            setRemoteState({ username, status: 'available', message: 'Username is available.', ready: true })
          } else {
            setRemoteState({ username, status: 'taken', message: 'That username is already taken.', ready: false })
          }
        })
        .catch(() => {
          if (!active) return
          setRemoteState({
            username,
            status: 'error',
            message: 'We could not check this username. Please try again.',
            ready: false,
          })
        })
    }, 400)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [candidate, shouldCheck])

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
          onChange={(event) => {
            setServerErrorActive(false)
            setRemoteState(null)
            setValue(normalizeUsername(event.target.value))
          }}
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
