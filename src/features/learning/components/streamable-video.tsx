'use client'

import { useState, type ComponentProps } from 'react'
import { useDataSaver } from '@/lib/browser/data-saver'
import { useHlsStream, type VideoStream } from './use-hls-stream'

/**
 * Round P3 (Part D): a plain `<video>` for course trailers and free previews that plays the ready rendition's HLS
 * ladder through hls.js where it can (360p only in Data saver) and its signed 720p MP4 (`src`) everywhere else.
 * Without a stream it is exactly the `<video src>` it replaces.
 */
export function StreamableVideo({ src, stream = null, ...props }: Omit<ComponentProps<'video'>, 'src' | 'ref'> & { src: string; stream?: VideoStream | null }) {
  const [node, setNode] = useState<HTMLVideoElement | null>(null)
  const dataSaver = useDataSaver()
  const mode = useHlsStream(node, stream, dataSaver)
  return <video {...props} ref={setNode} src={mode === 'file' ? src : undefined} />
}
