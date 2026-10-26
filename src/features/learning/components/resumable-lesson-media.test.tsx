import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveLearningPlaybackPosition: vi.fn(),
  refreshLessonMediaUrl: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }) }))

vi.mock('../learner-progress-actions', () => ({
  saveLearningPlaybackPosition: mocks.saveLearningPlaybackPosition,
}))

vi.mock('../learner-media-actions', () => ({
  refreshLessonMediaUrl: mocks.refreshLessonMediaUrl,
}))

import { ResumableLessonMedia } from './resumable-lesson-media'

const slug = 'sire-2-readiness'
const lessonId = '11111111-1111-4111-8111-111111111111'
const src = 'https://signed.example.com/lesson.mp4'

describe('ResumableLessonMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.saveLearningPlaybackPosition.mockResolvedValue({
      ok: true,
      lessonId,
      lastPositionSeconds: 140,
    })
  })

  afterEach(() => cleanup())

  // Round P3: a ready rendition plays through hls.js where it can; jsdom has no Media Source Extensions, so the
  // player falls back to the rendition's signed 720p MP4 (and never shows a src while it decides).
  it('plays a ready rendition, falling back to its signed MP4 where hls.js cannot play', async () => {
    const mp4 = '/m/v/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/mp4/video-720p.mp4?Policy=p&Signature=s&Key-Pair-Id=K2JCJMDEHXQW5F&Hash-Algorithm=SHA256'
    const { container } = render(
      <ResumableLessonMedia
        kind="video"
        src={mp4}
        stream={{ hls: mp4.replace('mp4/video-720p.mp4', 'hls/master.m3u8') }}
        slug={slug}
        lessonId={lessonId}
        initialPositionSeconds={0}
      />,
    )
    expect(container.querySelector('video')).not.toHaveAttribute('src')
    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', mp4))
  })

  it('offers to resume from the saved position instead of jumping there (round E)', () => {
    const { container } = render(
      <ResumableLessonMedia
        kind="video"
        src={src}
        slug={slug}
        lessonId={lessonId}
        initialPositionSeconds={125}
      />,
    )

    const media = container.querySelector('video')
    expect(media).not.toBeNull()
    Object.defineProperty(media!, 'duration', { configurable: true, value: 780 })

    fireEvent.loadedMetadata(media!)

    expect(media!.currentTime).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Resume from 2:05' }))
    expect(media!.currentTime).toBe(125)
    expect(screen.queryByRole('button', { name: /Resume from/ })).not.toBeInTheDocument()
    expect(media).toHaveAttribute('src', src)
    expect(media).toHaveAttribute('preload', 'metadata')
  })

  it('catches up when the metadata loaded before hydration (the event was missed)', () => {
    const readyState = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState')
    const duration = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 1 })
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => 780 })
    try {
      render(<ResumableLessonMedia kind="video" src={src} slug={slug} lessonId={lessonId} initialPositionSeconds={125} />)
      expect(screen.getByRole('button', { name: 'Resume from 2:05' })).toBeInTheDocument()
      expect(screen.getByText('0:00 / 13:00')).toBeInTheDocument()
    } finally {
      if (readyState) Object.defineProperty(HTMLMediaElement.prototype, 'readyState', readyState)
      if (duration) Object.defineProperty(HTMLMediaElement.prototype, 'duration', duration)
    }
  })

  it('can start over instead of resuming', () => {
    const { container } = render(<ResumableLessonMedia kind="video" src={src} slug={slug} lessonId={lessonId} initialPositionSeconds={125} />)
    const media = container.querySelector('video')!
    Object.defineProperty(media, 'duration', { configurable: true, value: 780 })
    fireEvent.loadedMetadata(media)
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(media.currentTime).toBe(0)
  })

  it('restores audio position without asking', () => {
    const { container } = render(<ResumableLessonMedia kind="audio" src="https://signed.example.com/a.mp3" slug={slug} lessonId={lessonId} initialPositionSeconds={42} />)
    const media = container.querySelector('audio')!
    Object.defineProperty(media, 'duration', { configurable: true, value: 300 })
    fireEvent.loadedMetadata(media)
    expect(media.currentTime).toBe(42)
  })

  it('checkpoints approximately every fifteen seconds instead of on every time update', async () => {
    const { container } = render(
      <ResumableLessonMedia
        kind="video"
        src={src}
        slug={slug}
        lessonId={lessonId}
        initialPositionSeconds={125}
      />,
    )

    const media = container.querySelector('video')!
    media.currentTime = 139
    fireEvent.timeUpdate(media)
    expect(mocks.saveLearningPlaybackPosition).not.toHaveBeenCalled()

    media.currentTime = 140
    fireEvent.timeUpdate(media)

    await waitFor(() => {
      expect(mocks.saveLearningPlaybackPosition).toHaveBeenCalledTimes(1)
      expect(mocks.saveLearningPlaybackPosition).toHaveBeenCalledWith(slug, lessonId, 140)
    })
  })

  it('tells the player once when the server completes the lesson, so "Complete & next" unlocks (round E)', async () => {
    mocks.saveLearningPlaybackPosition.mockResolvedValue({ ok: true, lessonId, lastPositionSeconds: 140, completed: true })
    const heard: string[] = []
    const listener = (event: Event) => heard.push((event as CustomEvent<{ lessonId: string }>).detail.lessonId)
    window.addEventListener('sea-n-shore:lesson-completed', listener)
    const { container } = render(<ResumableLessonMedia kind="video" src={src} slug={slug} lessonId={lessonId} initialPositionSeconds={125} />)
    const media = container.querySelector('video')!
    media.currentTime = 140
    fireEvent.timeUpdate(media)
    fireEvent.pause(media)
    await waitFor(() => expect(heard).toEqual([lessonId]))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    window.removeEventListener('sea-n-shore:lesson-completed', listener)
  })

  it('saves the latest whole-second position when playback is paused', async () => {
    const { container } = render(
      <ResumableLessonMedia
        kind="audio"
        src="https://signed.example.com/lesson.mp3"
        slug={slug}
        lessonId={lessonId}
        initialPositionSeconds={20}
      />,
    )

    const media = container.querySelector('audio')!
    media.currentTime = 33.9
    fireEvent.pause(media)

    await waitFor(() => {
      expect(mocks.saveLearningPlaybackPosition).toHaveBeenCalledWith(slug, lessonId, 33)
    })
  })

  it('serializes saves so an older response cannot overwrite a newer queued checkpoint', async () => {
    let resolveFirst: ((value: { ok: true; lessonId: string; lastPositionSeconds: number }) => void) | undefined
    mocks.saveLearningPlaybackPosition
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce({ ok: true, lessonId, lastPositionSeconds: 155 })

    const { container } = render(
      <ResumableLessonMedia
        kind="video"
        src={src}
        slug={slug}
        lessonId={lessonId}
        initialPositionSeconds={125}
      />,
    )

    const media = container.querySelector('video')!
    media.currentTime = 140
    fireEvent.timeUpdate(media)
    await waitFor(() => expect(mocks.saveLearningPlaybackPosition).toHaveBeenCalledTimes(1))

    media.currentTime = 155
    fireEvent.timeUpdate(media)
    expect(mocks.saveLearningPlaybackPosition).toHaveBeenCalledTimes(1)

    resolveFirst?.({ ok: true, lessonId, lastPositionSeconds: 140 })

    await waitFor(() => {
      expect(mocks.saveLearningPlaybackPosition).toHaveBeenCalledTimes(2)
      expect(mocks.saveLearningPlaybackPosition).toHaveBeenLastCalledWith(slug, lessonId, 155)
    })
  })

  describe('learning round A (A7): real viewing, speed and captions', () => {
    function video(props: Partial<Parameters<typeof ResumableLessonMedia>[0]> = {}) {
      const { container } = render(
        <ResumableLessonMedia kind="video" src={src} slug={slug} lessonId={lessonId} initialPositionSeconds={0} {...props} />,
      )
      const media = container.querySelector('video')!
      Object.defineProperty(media, 'duration', { configurable: true, value: 600 })
      return media
    }

    it('always allows seeking back, but forward only a few seconds past the furthest point watched', () => {
      const media = video({ initialPositionSeconds: 100, initialFurthestSeconds: 120 })
      fireEvent.loadedMetadata(media)

      media.currentTime = 30
      fireEvent.seeking(media)
      expect(media.currentTime).toBe(30)

      media.currentTime = 124
      fireEvent.seeking(media)
      expect(media.currentTime).toBe(124)

      media.currentTime = 400
      fireEvent.seeking(media)
      expect(media.currentTime).toBe(120)
      expect(screen.getByRole('status')).toHaveTextContent('You can skip ahead once you’ve watched up to here.')
    })

    it('lets a learner who completed the video watch it in any order', () => {
      const media = video({ completed: true })
      media.currentTime = 500
      fireEvent.seeking(media)
      expect(media.currentTime).toBe(500)
    })

    it('counts real playback time and sends it with the position', async () => {
      const media = video({ initialWatchedSeconds: 40, initialFurthestSeconds: 40, initialPositionSeconds: 40 })
      fireEvent.loadedMetadata(media)
      fireEvent.click(screen.getByRole('button', { name: 'Resume from 0:40' }))
      for (let second = 41; second <= 56; second += 1) {
        media.currentTime = second
        fireEvent.timeUpdate(media)
      }
      await waitFor(() => expect(mocks.saveLearningPlaybackPosition).toHaveBeenCalledWith(slug, lessonId, 55, 600, 55))
    })

    it('offers speeds from 0.75× to 2×', () => {
      const media = video()
      const speed = screen.getByRole('combobox', { name: 'Speed' })
      expect(Array.from(speed.querySelectorAll('option')).map((option) => option.textContent)).toEqual(['0.75×', '1×', '1.25×', '1.5×', '1.75×', '2×'])
      fireEvent.change(speed, { target: { value: '1.5' } })
      expect(media.playbackRate).toBe(1.5)
    })

    it('adds captions and a transcript that jumps to a line', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nWelcome aboard.\n\n00:00:04.000 --> 00:00:06.000\nCheck the mooring lines.\n'))
      vi.stubGlobal('fetch', fetchMock)
      const media = video({ captionsSrc: `/api/learn/captions/${lessonId}`, initialFurthestSeconds: 30 })

      expect(media.querySelector('track')).toHaveAttribute('src', `/api/learn/captions/${lessonId}`)
      fireEvent.click(screen.getByRole('button', { name: 'Transcript' }))
      fireEvent.click(await screen.findByRole('button', { name: /Check the mooring lines/ }))
      expect(media.currentTime).toBe(4)
      expect(fetchMock).toHaveBeenCalledWith(`/api/learn/captions/${lessonId}`, { credentials: 'same-origin' })
      vi.unstubAllGlobals()
    })
  })
  describe('learning round E (E3): own controls, no download, fresh URLs, watermark, keys', () => {
    function video(props: Partial<Parameters<typeof ResumableLessonMedia>[0]> = {}) {
      const view = render(
        <ResumableLessonMedia kind="video" src={src} slug={slug} lessonId={lessonId} initialPositionSeconds={0} {...props} />,
      )
      const media = view.container.querySelector('video')!
      Object.defineProperty(media, 'duration', { configurable: true, value: 600 })
      return { media, ...view }
    }

    it('uses its own controls with no download, no remote playback and no context menu', () => {
      const { media } = video()
      expect(media).not.toHaveAttribute('controls')
      expect(media).toHaveAttribute('controlsList', 'nodownload noremoteplayback')
      expect(media).toHaveAttribute('disableRemotePlayback')
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      media.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      for (const name of ['Play', 'Mute', 'Full screen', 'Keyboard shortcuts']) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      }
      expect(screen.getByRole('slider', { name: 'Seek' })).toBeInTheDocument()
      expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument()
      expect(screen.queryByText(/download/i)).not.toBeInTheDocument()
    })

    it('keeps the round A seek cap on its own seek bar', () => {
      const { media } = video({ initialFurthestSeconds: 60 })
      fireEvent.loadedMetadata(media)
      fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '300' } })
      fireEvent.seeking(media)
      expect(media.currentTime).toBe(60)
    })

    it('shows the member code watermark (never a name or email)', () => {
      const { container } = video({ watermark: 'SNS-1A2B3C4D · 11 Oct 2026' })
      const mark = container.querySelector('.lesson-video-watermark')
      expect(mark).toHaveTextContent('SNS-1A2B3C4D · 11 Oct 2026')
      expect(mark?.closest('[aria-hidden="true"]')).not.toBeNull()
    })

    it('answers J, L, M and ? on the player, and lists the shortcuts', () => {
      const { media } = video({ initialFurthestSeconds: 600 })
      media.currentTime = 100
      const player = screen.getByRole('group', { name: 'Video player' })
      fireEvent.keyDown(player, { key: 'l' })
      expect(media.currentTime).toBe(110)
      fireEvent.keyDown(player, { key: 'j' })
      fireEvent.keyDown(player, { key: 'j' })
      expect(media.currentTime).toBe(90)
      fireEvent.keyDown(player, { key: 'm' })
      expect(media.muted).toBe(true)
      expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument()
      expect(screen.getByText('Keyboard shortcuts', { selector: 'p' }).closest('[hidden]')).not.toBeNull()
      fireEvent.keyDown(player, { key: '?' })
      expect(screen.getByText('Keyboard shortcuts', { selector: 'p' }).closest('[hidden]')).toBeNull()
      expect(screen.getByText('Back or forward 10 seconds')).toBeInTheDocument()
    })

    it('swaps in a fresh URL after an error and continues from the same place', async () => {
      mocks.refreshLessonMediaUrl.mockResolvedValue({ ok: true, url: 'https://signed.example.com/fresh.mp4', expiresAt: new Date(Date.now() + 1_200_000).toISOString() })
      const { media } = video({ initialFurthestSeconds: 600 })
      media.currentTime = 250
      fireEvent.error(media)
      await waitFor(() => expect(media).toHaveAttribute('src', 'https://signed.example.com/fresh.mp4'))
      expect(mocks.refreshLessonMediaUrl).toHaveBeenCalledWith(slug, lessonId)
      media.currentTime = 0
      fireEvent.loadedMetadata(media)
      expect(media.currentTime).toBe(250)
      expect(screen.queryByRole('button', { name: /Resume from/ })).not.toBeInTheDocument()
    })

    it('refreshes the URL a few minutes before it expires', async () => {
      vi.useFakeTimers()
      try {
        mocks.refreshLessonMediaUrl.mockResolvedValue({ ok: true, url: 'https://signed.example.com/next.mp4', expiresAt: new Date(Date.now() + 1_200_000).toISOString() })
        video({ expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString() })
        await vi.advanceTimersByTimeAsync(16 * 60 * 1000)
        expect(mocks.refreshLessonMediaUrl).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(60 * 1000 + 50)
        expect(mocks.refreshLessonMediaUrl).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not loop when the fresh URL fails too', async () => {
      mocks.refreshLessonMediaUrl.mockResolvedValue({ ok: true, url: 'https://signed.example.com/fresh.mp4', expiresAt: new Date(Date.now() + 1_200_000).toISOString() })
      const { media } = video()
      fireEvent.error(media)
      await waitFor(() => expect(media).toHaveAttribute('src', 'https://signed.example.com/fresh.mp4'))
      fireEvent.error(media)
      expect(await screen.findByRole('alert')).toHaveTextContent('This material could not be played.')
      expect(mocks.refreshLessonMediaUrl).toHaveBeenCalledTimes(1)
    })

    it('says so when a fresh URL cannot be had', async () => {
      mocks.refreshLessonMediaUrl.mockResolvedValue({ ok: false, error: 'This material is locked.' })
      const { media } = video()
      fireEvent.error(media)
      expect(await screen.findByRole('alert')).toHaveTextContent('This material is locked.')
    })
  })
})
