import { readMediaObjectPrefix } from '@/lib/aws/storage'
import { FILE_SIGNATURE_BYTES, matchesFileSignature } from './file-signature'

/**
 * Round P3: reads the first bytes of an uploaded object and checks they are really the declared type.
 * 'unavailable' when the object cannot be read (the caller decides whether that blocks the save).
 */
export async function verifyStoredUploadSignature(
  key: string,
  mimeType: string,
  size: number,
): Promise<'match' | 'mismatch' | 'unavailable'> {
  let prefix: Uint8Array
  try {
    prefix = await readMediaObjectPrefix(key, Math.max(1, Math.min(FILE_SIGNATURE_BYTES, size)))
  } catch {
    return 'unavailable'
  }
  return matchesFileSignature(mimeType, prefix) ? 'match' : 'mismatch'
}
