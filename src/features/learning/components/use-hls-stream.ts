'use client'

import { useEffect, useRef, useState } from 'react'

/** A ready rendition's adaptive playlist (360p and 720p), signed for its whole folder. */
export type VideoStream = { hls: string }

export type StreamMode = 'pending' | 'hls' | 'file'

function folderOf(url: string) {
  return url.split('?', 1)[0]!.replace(/\/[^/]*$/, '')
}

/**
 * Round P3 (Part D): plays a course video's HLS rendition with hls.js where the browser supports Media Source
 * Extensions (most desktop and Android browsers, and Safari on iOS 17.1+ through Managed Media Source); anywhere
 * else the caller keeps the signed 720p MP4. Returns which one to use: while `pending` (and in `hls` mode) the
 * element must not carry a `src` attribute, so React never removes the source hls.js attached.
 *
 * Every playlist and segment request carries the folder's current signed query (the segments are listed without
 * one), and a refreshed query is picked up by the next request without restarting playback. In Data saver the
 * player starts at, and stays on, the lowest rendition (360p) and loads nothing until the video is played.
 */
export function useHlsStream(media: HTMLMediaElement | null, stream: VideoStream | null, dataSaver: boolean): StreamMode {
  const folder = stream ? folderOf(stream.hls) : null
  const query = stream?.hls.split('?')[1] ?? ''
  const queryRef = useRef(query)
  useEffect(() => {
    queryRef.current = query
  }, [query])
  // Per folder: whether hls.js can play here, and whether it gave up (a fatal error) and the MP4 took over.
  const [support, setSupport] = useState<{ folder: string; hls: boolean } | null>(null)
  const [failedFolder, setFailedFolder] = useState<string | null>(null)
  const mode: StreamMode = !folder
    ? 'file'
    : support?.folder !== folder
      ? 'pending'
      : support.hls && failedFolder !== folder ? 'hls' : 'file'

  // Decide once per stream whether hls.js can play it here.
  useEffect(() => {
    if (!folder) return
    let cancelled = false
    import('hls.js')
      .then(({ default: Hls }) => { if (!cancelled) setSupport({ folder, hls: Hls.isSupported() }) })
      .catch(() => { if (!cancelled) setSupport({ folder, hls: false }) })
    return () => { cancelled = true }
  }, [folder])

  // Attach once the element has rendered without a src attribute.
  useEffect(() => {
    if (mode !== 'hls' || !media || !stream || !folder) return
    let destroyed = false
    let instance: { destroy: () => void; startLoad: (position?: number) => void } | null = null
    let onPlay: (() => void) | null = null
    void import('hls.js').then(({ default: Hls }) => {
      if (destroyed) return
      const hls = new Hls({
        startLevel: dataSaver ? 0 : -1,
        capLevelToPlayerSize: true,
        autoStartLoad: !dataSaver,
        xhrSetup: (xhr, url) => {
          const target = new URL(url, window.location.href)
          if (target.origin !== window.location.origin || !target.pathname.startsWith(`${folder}/`)) return
          xhr.open('GET', `${target.pathname}?${queryRef.current}`, true)
        },
      })
      instance = hls
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (dataSaver) hls.autoLevelCapping = 0
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return
        hls.destroy()
        instance = null
        setFailedFolder(folder)
      })
      if (dataSaver) {
        onPlay = () => hls.startLoad()
        media.addEventListener('play', onPlay, { once: true })
      }
      hls.loadSource(stream.hls)
      hls.attachMedia(media as HTMLVideoElement)
    }).catch(() => { if (!destroyed) setFailedFolder(folder) })
    return () => {
      destroyed = true
      if (onPlay) media.removeEventListener('play', onPlay)
      instance?.destroy()
    }
    // A refreshed query (same folder) must not restart playback; queryRef carries it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, media, folder, dataSaver])

  return mode
}
