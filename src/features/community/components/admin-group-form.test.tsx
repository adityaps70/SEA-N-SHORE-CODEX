import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createGroupAsAdmin: vi.fn<(...args: unknown[]) => Promise<{ ok: false; error: string }>>(async () => ({ ok: false, error: 'No member found for that owner.' })),
}))

vi.mock('../admin-actions', () => ({
  createGroupAsAdmin: mocks.createGroupAsAdmin,
  updateGroupAsAdmin: vi.fn(),
  setGroupOwnerAsAdmin: vi.fn(),
}))

import { AdminGroupForm } from './admin-group-form'

afterEach(() => cleanup())

describe('AdminGroupForm keeps what was typed on an error (hotfix P2)', () => {
  it('keeps every field when the create is refused', async () => {
    const { container } = render(<AdminGroupForm categories={[{ id: 'cat-1', name: 'Deck', slug: 'deck', icon: null, hidden: false }]} />)
    const field = (name: string) => container.querySelector(`[name="${name}"]`) as HTMLInputElement
    const typed: Record<string, string> = { name: 'Port Captains', owner: '@asha-singh', description: 'For port captains.', rules: 'Be kind.', categoryId: 'cat-1', visibility: 'private' }
    for (const [name, value] of Object.entries(typed)) fireEvent.change(field(name), { target: { value } })
    fireEvent.submit(container.querySelector('form')!)

    expect(await screen.findByRole('alert')).toHaveTextContent('No member found for that owner.')
    expect(mocks.createGroupAsAdmin).toHaveBeenCalledTimes(1)
    for (const [name, value] of Object.entries(typed)) expect(field(name).value, name).toBe(value)
  })
})
