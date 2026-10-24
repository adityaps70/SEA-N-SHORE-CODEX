import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCommunity: vi.fn<(...args: unknown[]) => Promise<{ ok: false; error: string }>>(async () => ({ ok: false, error: 'A community with that name already exists.' })),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../create-actions', () => ({ createCommunity: mocks.createCommunity }))
vi.mock('../media-actions', () => ({ requestCommunityMediaUploadAction: vi.fn(), completeCommunityMediaUploadAction: vi.fn() }))

import { CreateCommunityForm } from './create-community-form'

afterEach(() => cleanup())

describe('CreateCommunityForm keeps what was typed on an error (hotfix P2)', () => {
  it('keeps the name, description, category, rules and choices when the create is refused', async () => {
    const { container } = render(
      <CreateCommunityForm
        identities={[{ value: 'self', label: 'Myself' }]}
        categories={[{ id: 'cat-1', name: 'Deck', slug: 'deck', icon: null, hidden: false }]}
      />,
    )
    const field = (name: string) => container.querySelector(`[name="${name}"]:not([type="radio"])`) as HTMLInputElement
    const typed: Record<string, string> = { name: 'LNG Officers', description: 'For officers on LNG carriers.', categoryId: 'cat-1', rules: 'No recruitment spam.' }
    for (const [name, value] of Object.entries(typed)) fireEvent.change(field(name), { target: { value } })
    const joinPolicies = container.querySelectorAll<HTMLInputElement>('input[type="radio"][name="joinPolicy"]')
    const notDefault = joinPolicies[joinPolicies.length - 1]!
    fireEvent.click(notDefault)
    fireEvent.submit(container.querySelector('form')!)

    expect(await screen.findByText('A community with that name already exists.')).toBeInTheDocument()
    expect(mocks.createCommunity).toHaveBeenCalledTimes(1)
    for (const [name, value] of Object.entries(typed)) expect(field(name).value, name).toBe(value)
    expect(notDefault).toBeChecked()
  })
})
