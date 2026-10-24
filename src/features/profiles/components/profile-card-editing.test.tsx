import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useActionState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileCardForm } from './profile-card-editing'

type CardState = { error: string | null }

async function refuse(): Promise<CardState> {
  return { error: 'We could not save your changes. Please try again.' }
}

/** Every Maritime Passport card editor (header, About, experience, career, credentials, organizations) is a ProfileCardForm. */
function Card() {
  const [state, formAction, pending] = useActionState<CardState, FormData>(refuse, { error: null })
  return (
    <ProfileCardForm cardId="profile-about" label="Edit About" action={formAction} pending={pending} onCancel={() => undefined} error={state.error}>
      <label>Summary<textarea name="summary" defaultValue="Saved summary" /></label>
      <label>Skills<input name="skills" defaultValue="Navigation" /></label>
    </ProfileCardForm>
  )
}

afterEach(() => cleanup())

describe('ProfileCardForm keeps what was typed on an error (hotfix P2)', () => {
  it('keeps the edited fields when the save is refused', async () => {
    render(<Card />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: 'Twelve years on LNG carriers.' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Skills' }), { target: { value: 'Navigation, LNG cargo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not save your changes.')
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Twelve years on LNG carriers.')
    expect(screen.getByRole('textbox', { name: 'Skills' })).toHaveValue('Navigation, LNG cargo')
  })
})
