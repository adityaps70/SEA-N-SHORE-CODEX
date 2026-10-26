import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hls = vi.hoisted(() => {
  const instances: Array<{
    config: Record<string, unknown> & { xhrSetup: (xhr: { open: (...args: unknown[]) => void }, url: string) => void }
    loadSource: ReturnType<typeof vi.fn>
    attachMedia: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    startLoad: ReturnType<typeof vi.fn>
    handlers: Record<string, (event: string, data: { fatal?: boolean }) => void>
    autoLevelCapping: number
  }> = []
  const state = { supported: true }
  class FakeHls {
    static Events = { MANIFEST_PARSED: 'hlsManifestParsed', ERROR: 'hlsError' }
    static isSupported = () => state.supported
    config: Record<string, unknown>
    loadSource = vi.fn()
    attachMedia = vi.fn()
    destroy = vi.fn()
    startLoad = vi.fn()
    handlers: Record<string, (event: string, data: { fatal?: boolean }) => void> = {}
    autoLevelCapping = -1
    constructor(config: Record<string, unknown>) {
      this.config = config
      instances.push(this as never)
    }
    on(event: string, handler: (event: string, data: { fatal?: boolean }) => void) {
      this.handlers[event] = handler
    }
  }
  return { instances, state, FakeHls }
})
vi.mock('hls.js', () => ({ default: hls.FakeHls }))

const dataSaver = vi.hoisted(() => ({ on: false }))
vi.mock('@/lib/browser/data-saver', () => ({ useDataSaver: () => dataSaver.on }))

import { StreamableVideo } from './streamable-video'

const FOLDER = '/m/v/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const QUERY = 'Policy=p1&Signature=s1&Key-Pair-Id=K2JCJMDEHXQW5F&Hash-Algorithm=SHA256'
const MP4 = `${FOLDER}/mp4/video-720p.mp4?${QUERY}`
const HLS = `${FOLDER}/hls/master.m3u8?${QUERY}`

describe('StreamableVideo (Round P3 course video renditions)', () => {
  beforeEach(() => {
    hls.instances.length = 0
    hls.state.supported = true
    dataSaver.on = false
  })
  afterEach(() => cleanup())

  it('is a plain video with the file when there is no rendition', () => {
    const { container } = render(<StreamableVideo src="https://signed.example.com/trailer.mp4" controls />)
    expect(container.querySelector('video')).toHaveAttribute('src', 'https://signed.example.com/trailer.mp4')
    expect(hls.instances).toHaveLength(0)
  })

  it('falls back to the signed 720p MP4 where hls.js cannot play', async () => {
    hls.state.supported = false
    const { container } = render(<StreamableVideo src={MP4} stream={{ hls: HLS }} />)
    expect(container.querySelector('video')).not.toHaveAttribute('src')
    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', MP4))
    expect(hls.instances).toHaveLength(0)
  })

  it('plays the HLS ladder through hls.js and signs every playlist and segment request with the current query', async () => {
    const { container, rerender } = render(<StreamableVideo src={MP4} stream={{ hls: HLS }} />)
    await waitFor(() => expect(hls.instances).toHaveLength(1))
    const [instance] = hls.instances
    const video = container.querySelector('video')!
    expect(video).not.toHaveAttribute('src')
    expect(instance!.loadSource).toHaveBeenCalledWith(HLS)
    expect(instance!.attachMedia).toHaveBeenCalledWith(video)
    expect(instance!.config).toMatchObject({ startLevel: -1, autoStartLoad: true, capLevelToPlayerSize: true })

    const xhr = { open: vi.fn() }
    instance!.config.xhrSetup(xhr, `${window.location.origin}${FOLDER}/hls/master_720p_00001.ts`)
    expect(xhr.open).toHaveBeenCalledWith('GET', `${FOLDER}/hls/master_720p_00001.ts?${QUERY}`, true)
    const other = { open: vi.fn() }
    instance!.config.xhrSetup(other, 'https://elsewhere.example.com/x.ts')
    expect(other.open).not.toHaveBeenCalled()

    // A refreshed query for the same folder is used by the next request, without restarting playback.
    const refreshed = 'Policy=p2&Signature=s2&Key-Pair-Id=K2JCJMDEHXQW5F&Hash-Algorithm=SHA256'
    rerender(<StreamableVideo src={`${FOLDER}/mp4/video-720p.mp4?${refreshed}`} stream={{ hls: `${FOLDER}/hls/master.m3u8?${refreshed}` }} />)
    await waitFor(() => {
      const next = { open: vi.fn() }
      instance!.config.xhrSetup(next, `${window.location.origin}${FOLDER}/hls/master_720p_00002.ts`)
      expect(next.open).toHaveBeenCalledWith('GET', `${FOLDER}/hls/master_720p_00002.ts?${refreshed}`, true)
    })
    expect(hls.instances).toHaveLength(1)
    expect(instance!.destroy).not.toHaveBeenCalled()
  })

  it('in Data saver starts on and stays at 360p, and loads nothing until played', async () => {
    dataSaver.on = true
    const { container } = render(<StreamableVideo src={MP4} stream={{ hls: HLS }} />)
    await waitFor(() => expect(hls.instances).toHaveLength(1))
    const [instance] = hls.instances
    expect(instance!.config).toMatchObject({ startLevel: 0, autoStartLoad: false })
    instance!.handlers.hlsManifestParsed!('hlsManifestParsed', {})
    expect(instance!.autoLevelCapping).toBe(0)
    expect(instance!.startLoad).not.toHaveBeenCalled()
    container.querySelector('video')!.dispatchEvent(new Event('play'))
    expect(instance!.startLoad).toHaveBeenCalledTimes(1)
  })

  it('switches to the MP4 after a fatal HLS error', async () => {
    const { container } = render(<StreamableVideo src={MP4} stream={{ hls: HLS }} />)
    await waitFor(() => expect(hls.instances).toHaveLength(1))
    hls.instances[0]!.handlers.hlsError!('hlsError', { fatal: true })
    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', MP4))
    expect(hls.instances[0]!.destroy).toHaveBeenCalled()
  })
})
