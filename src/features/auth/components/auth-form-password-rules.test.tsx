import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}))

import { AuthForm } from './auth-form'

afterEach(() => cleanup())

const action = vi.fn(async () => ({}))

function rules() {
  const password = screen.getByLabelText('Password')
  const list = document.getElementById(password.getAttribute('aria-describedby') ?? '')
  if (!list) throw new Error('password rules list missing')
  return { password, items: within(list).getAllByRole('listitem') }
}

describe('sign-up password rules', () => {
  it('shows every rule under the password field before anything is typed', () => {
    render(<AuthForm mode="sign-up" action={action} />)
    const { items } = rules()
    expect(items.map((item) => item.textContent)).toEqual([
      'Needed: At least 12 characters',
      'Needed: A lowercase letter',
      'Needed: An uppercase letter',
      'Needed: A number',
    ])
    expect(screen.queryByText('Use at least 12 characters.')).not.toBeInTheDocument()
  })

  it('ticks each rule off as the person types', () => {
    render(<AuthForm mode="sign-up" action={action} />)
    fireEvent.change(rules().password, { target: { value: 'harbour' } })
    expect(rules().items.map((item) => item.textContent)).toEqual([
      'Needed: At least 12 characters',
      'Done: A lowercase letter',
      'Needed: An uppercase letter',
      'Needed: A number',
    ])

    fireEvent.change(rules().password, { target: { value: 'HarbourPilot2026' } })
    expect(rules().items.every((item) => item.textContent?.startsWith('Done: '))).toBe(true)
  })

  it('leaves sign-in and password reset as they are', () => {
    render(<AuthForm mode="sign-in" action={action} />)
    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-describedby')
    cleanup()
    render(<AuthForm mode="update-password" action={action} />)
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument()
    expect(screen.queryByText('A lowercase letter')).not.toBeInTheDocument()
  })
})
