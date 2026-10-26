import { createLessonMediaUrl, createMediaReadUrl } from '@/lib/aws/storage'
import { query as databaseQuery } from '@/lib/db/client'
import { readyRenditionPaths, renditionSources } from './media-renditions'
import type { VideoStream } from './components/use-hls-stream'

export type LessonMediaSource = { url: string; expiresAt: string | null; stream?: VideoStream }

/**
 * Round P3 (Part D): what a player gets for a course video the viewer may already watch. A ready MediaConvert
 * rendition gives its signed 720p MP4 plus the adaptive HLS playlist; otherwise the uploaded file as before (lesson
 * video and audio on the 20-minute lesson URL, trailers and previews on the windowed read URL).
 */
export async function courseVideoSource(assetPath: string, use: 'lesson' | 'audio' | 'trailer' | 'preview'): Promise<LessonMediaSource> {
  if (use !== 'audio') {
    const ready = await readyRenditionPaths(databaseQuery, [assetPath])
    const rendition = ready.has(assetPath) ? renditionSources(assetPath) : null
    if (rendition) return { url: rendition.mp4, expiresAt: rendition.expiresAt, stream: { hls: rendition.hls } }
  }
  if (use === 'lesson' || use === 'audio') return createLessonMediaUrl(assetPath)
  return { url: await createMediaReadUrl(assetPath), expiresAt: null }
}
