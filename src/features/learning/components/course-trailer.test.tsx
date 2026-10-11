import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseTrailer } from './course-trailer'

function stubScreen(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

function both() {
  return render(
    <>
      <CourseTrailer slot="phone" src="https://signed.example.com/t.mp4" label="Trailer" fallback={<span>phone cover</span>} />
      <CourseTrailer slot="desktop" src="https://signed.example.com/t.mp4" label="Trailer" fallback={<span>desktop cover</span>} />
    </>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CourseTrailer (round E)', () => {
  it('renders one video on a phone, in the phone slot', () => {
    stubScreen(true)
    const { container, getByText } = both()
    expect(container.querySelectorAll('video')).toHaveLength(1)
    expect(getByText('desktop cover')).toBeInTheDocument()
  })

  it('renders one video on a wider screen, in the desktop slot, without download or remote playback', () => {
    stubScreen(false)
    const { container, getByText } = both()
    const videos = container.querySelectorAll('video')
    expect(videos).toHaveLength(1)
    expect(videos[0]).toHaveAttribute('controlsList', 'nodownload noremoteplayback')
    expect(videos[0]).toHaveAttribute('disableRemotePlayback')
    expect(getByText('phone cover')).toBeInTheDocument()
  })
})
