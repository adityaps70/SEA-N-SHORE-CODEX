import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveLearningPlaybackPosition: vi.fn(),
}))

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
})
