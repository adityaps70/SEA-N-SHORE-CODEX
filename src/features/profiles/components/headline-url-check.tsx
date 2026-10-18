'use client'

import { useEffect, useState } from 'react'
import { HEADLINE_URL_MESSAGE, isUrlOnlyHeadline } from '../headline'

/**
 * Round H (H7): the form side of the headline rule. When the whole headline is a web address, it shows the same
 * friendly message as the server and marks the field invalid, once the member leaves the field.
 */
export function HeadlineUrlCheck({ inputId }: { inputId: string }) {
  const [invalid, setInvalid] = useState(false)
  const messageId = `${inputId}-url-error`

  useEffect(() => {
    const input = document.getElementById(inputId) as HTMLInputElement | null
    if (!input) return
    const describedBy = input.getAttribute('aria-describedby') ?? ''
    const check = () => {
      const bad = isUrlOnlyHeadline(input.value)
      setInvalid(bad)
      input.setCustomValidity(bad ? HEADLINE_URL_MESSAGE : '')
      input.toggleAttribute('aria-invalid', bad)
      const ids = describedBy.split(' ').filter(Boolean)
      input.setAttribute('aria-describedby', (bad ? [...ids, messageId] : ids).join(' '))
      if (!bad && !ids.length) input.removeAttribute('aria-describedby')
    }
    const clearWhenFixed = () => {
      if (!isUrlOnlyHeadline(input.value)) check()
    }
    input.addEventListener('blur', check)
    input.addEventListener('input', clearWhenFixed)
    return () => {
      input.removeEventListener('blur', check)
      input.removeEventListener('input', clearWhenFixed)
    }
  }, [inputId, messageId])

  return invalid ? <p id={messageId} className="mt-1 text-sm font-medium text-red-700">{HEADLINE_URL_MESSAGE}</p> : null
}
