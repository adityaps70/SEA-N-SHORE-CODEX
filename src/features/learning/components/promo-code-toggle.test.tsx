import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  setPromoCodeDisabled: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../promo-code-actions', () => ({ setPromoCodeDisabled: mocks.setPromoCodeDisabled }))

import { PromoCodeToggle } from './promo-code-toggle'

const codeId = '66666666-6666-4666-8666-666666666666'

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.setPromoCodeDisabled.mockResolvedValue({ ok: true })
})

describe('PromoCodeToggle', () => {
  it('turns an active code off and refreshes the list', async () => {
    render(<PromoCodeToggle codeId={codeId} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(mocks.setPromoCodeDisabled).toHaveBeenCalledWith(codeId, true)
  })

  it('turns a stopped code back on', async () => {
    render(<PromoCodeToggle codeId={codeId} disabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))

    await waitFor(() => expect(mocks.setPromoCodeDisabled).toHaveBeenCalledWith(codeId, false))
  })

  it('shows the server’s error and does not refresh', async () => {
    mocks.setPromoCodeDisabled.mockResolvedValue({ ok: false, error: 'We could not find this code. Reload the page and try again.' })
    render(<PromoCodeToggle codeId={codeId} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find this code. Reload the page and try again.')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
