import { render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  uploadAvatarAction: vi.fn(async () => ({})),
  uploadCoverAction: vi.fn(async () => ({})),
  removeAvatarAction: vi.fn(async () => ({ success: true })),
  removeCoverAction: vi.fn(async () => ({ success: true })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('../profile-media-actions', () => ({
  uploadAvatarAction: mocks.uploadAvatarAction,
  uploadCoverAction: mocks.uploadCoverAction,
  removeAvatarAction: mocks.removeAvatarAction,
  removeCoverAction: mocks.removeCoverAction,
}))

import { ProfileMediaControls } from './profile-media-controls'

describe('ProfileMediaControls hydration safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the profile-photo trigger disabled in server HTML until client hydration can handle clicks', () => {
    const markup = renderToStaticMarkup(<ProfileMediaControls kind="avatar" hasImage={false} />)
    const host = document.createElement('div')
    host.innerHTML = markup

    const serverButton = host.querySelector('button[aria-label="Add profile photo"]')
    expect(serverButton).not.toBeNull()
    expect(serverButton).toBeDisabled()

    render(<ProfileMediaControls kind="avatar" hasImage={false} />)
    expect(screen.getByRole('button', { name: 'Add profile photo' })).toBeEnabled()
  })
})
