import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveLearningPlaybackPosition: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }) }))

vi.mock('../learner-progress-actions', () => ({
  saveLearningPlaybackPosition: mocks.saveLearningPlaybackPosition,
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

  it('restores persisted video position after metadata loads', () => {
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

    expect(media!.currentTime).toBe(125)
    expect(media).toHaveAttribute('src', src)
    expect(media).toHaveAttribute('preload', 'metadata')
    expect(media).toHaveAttribute('controls')
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
})
