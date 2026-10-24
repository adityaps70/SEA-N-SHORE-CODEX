import { startTransition, type FormEvent } from 'react'

/**
 * Hotfix P2: React 19 resets a form's uncontrolled fields after every `<form action={fn}>` submit, even
 * when the action returns errors, so whatever the member typed is lost. Use this as the form's onSubmit
 * (keeping `action` for the pre-hydration fallback): it stops the native submit and React's form action,
 * then runs the same action in a transition, which React does not follow with a reset. useFormStatus and
 * useActionState's pending state still work.
 */
export function submitWithoutReset(event: FormEvent<HTMLFormElement>, dispatch: (formData: FormData) => void) {
  event.preventDefault()
  const submitter = (event.nativeEvent as SubmitEvent).submitter
  const formData = new FormData(event.currentTarget, isSubmitter(submitter) ? submitter : undefined)
  startTransition(() => dispatch(formData))
}

function isSubmitter(element: Element | null | undefined): element is HTMLButtonElement | HTMLInputElement {
  return Boolean(element && (element.tagName === 'BUTTON' || element.tagName === 'INPUT'))
}
