import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { submitWithoutReset } from './submit-without-reset'

type State = { error: string | null; submitted: string | null }

async function refuse(_previous: State, formData: FormData): Promise<State> {
  await new Promise((resolve) => setTimeout(resolve, 10))
  return { error: 'Something went wrong.', submitted: String(formData.get('intent') ?? '') }
}

function Pending() {
  const { pending } = useFormStatus()
  return <span>{pending ? 'Saving' : 'Idle'}</span>
}

function ProfileLikeForm({ keepValues }: { keepValues: boolean }) {
  const [state, formAction] = useActionState(refuse, { error: null, submitted: null })
  return (
    <form action={formAction} onSubmit={keepValues ? (event) => submitWithoutReset(event, formAction) : undefined}>
      <label>Headline<input name="headline" defaultValue="" /></label>
      <label>About<textarea name="about" defaultValue="Saved text" /></label>
      <label><input type="checkbox" name="open" /> Open to work</label>
      <Pending />
      <button type="submit" name="intent" value="publish">Publish</button>
      {state.error ? <p role="alert">{state.error} ({state.submitted})</p> : null}
    </form>
  )
}

function fillAndSubmit() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Headline' }), { target: { value: 'Chief Engineer' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'About' }), { target: { value: 'Typed again' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Open to work' }))
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
}

afterEach(() => cleanup())

describe('submitWithoutReset (hotfix P2)', () => {
  it('shows the bug it fixes: React resets a form action’s uncontrolled fields even when it returns an error', async () => {
    render(<ProfileLikeForm keepValues={false} />)
    fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    expect(screen.getByRole('textbox', { name: 'Headline' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'About' })).toHaveValue('Saved text')
  })

  it('runs the same action, with the button’s value and the pending state, and keeps every field', async () => {
    render(<ProfileLikeForm keepValues />)
    fillAndSubmit()
    expect(await screen.findByText('Saving')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. (publish)')
    await waitFor(() => expect(screen.getByText('Idle')).toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Headline' })).toHaveValue('Chief Engineer')
    expect(screen.getByRole('textbox', { name: 'About' })).toHaveValue('Typed again')
    expect(screen.getByRole('checkbox', { name: 'Open to work' })).toBeChecked()
  })
})
