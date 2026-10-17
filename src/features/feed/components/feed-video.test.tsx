import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../actions', () => ({ createPostVideoPosterUpload: vi.fn() }))
const upload = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../video-poster', () => ({ uploadVideoPoster: upload }))

import { FeedVideo, VIDEO_RETRY_DELAYS_MS, VIDEO_STALL_MS, feedVideoPosterUrl, feedVideoStoragePath } from './feed-video'

const SRC = '/api/feed-media/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.mp4'

describe('FeedVideo', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows the poster stored next to the video', () => {
    render(<FeedVideo src={SRC} label="Video" />)
    expect(screen.getByLabelText('Video')).toHaveAttribute('poster', SRC.replace('.mp4', '.poster.jpg'))
  })

  it('retries a failed load with backoff, then offers Tap to retry instead of spinning forever', () => {
    vi.useFakeTimers()
    render(<FeedVideo src={SRC} label="Video" />)
    const srcs = () => screen.getByLabelText('Video').getAttribute('src')

    fireEvent.error(screen.getByLabelText('Video'))
    act(() => { vi.advanceTimersByTime(VIDEO_RETRY_DELAYS_MS[0] - 1) })
    expect(srcs()).toBe(SRC)
    act(() => { vi.advanceTimersByTime(1) })
    expect(srcs()).toBe(`${SRC}?attempt=1`)

    fireEvent.error(screen.getByLabelText('Video'))
    act(() => { vi.advanceTimersByTime(VIDEO_RETRY_DELAYS_MS[1]) })
    expect(srcs()).toBe(`${SRC}?attempt=2`)

    fireEvent.error(screen.getByLabelText('Video'))
    const button = screen.getByRole('button', { name: 'Tap to retry' })
    fireEvent.click(button)
    expect(srcs()).toBe(`${SRC}?attempt=3`)
    expect(screen.queryByRole('button', { name: 'Tap to retry' })).not.toBeInTheDocument()
  })

  it('treats a stall with no progress as a failure', () => {
    vi.useFakeTimers()
    render(<FeedVideo src={SRC} label="Video" />)
    fireEvent(screen.getByLabelText('Video'), new Event('waiting'))
    act(() => { vi.advanceTimersByTime(VIDEO_STALL_MS + VIDEO_RETRY_DELAYS_MS[0]) })
    expect(screen.getByLabelText('Video').getAttribute('src')).toBe(`${SRC}?attempt=1`)
  })

  it('lets the author make a missing poster from the same-origin copy', async () => {
    class FailingImage {
      onerror: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onerror?.()) }
    }
    vi.stubGlobal('Image', FailingImage)
    render(<FeedVideo src={SRC} label="Video" canMakePoster />)
    await vi.waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      videoStoragePath: '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.mp4',
      source: `${SRC}?source=poster`,
    })))
  })

  it('derives poster and storage paths only for feed videos', () => {
    expect(feedVideoPosterUrl('/api/feed-media/a/b/c.webm')).toBe('/api/feed-media/a/b/c.poster.jpg')
    expect(feedVideoPosterUrl('https://example.com/c.mp4')).toBeNull()
    expect(feedVideoStoragePath('/api/feed-media/a/b/c.mp4?attempt=2')).toBe('a/b/c.mp4')
  })
})
