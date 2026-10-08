'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * React resets a form's native fields after its action runs, which puts controlled selects back on
 * their first option while the component state still holds the pick. Keying the fields with this
 * counter remounts them on the form's reset event, so they redraw from state.
 */
export function useFormResetKey<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    const form = ref.current?.closest('form')
    if (!form) return
    const onReset = () => setResetKey((count) => count + 1)
    form.addEventListener('reset', onReset)
    return () => form.removeEventListener('reset', onReset)
  }, [])

  return { ref, resetKey }
}
