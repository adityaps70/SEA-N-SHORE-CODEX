import type { CommunityMediaKind } from './media'

export const COMMUNITY_MEDIA_FAILURE_NOTICE =
  'Community created. The banner/photo didn’t upload — you can add it from the community page'

export function communityMediaCancelDestination(slug: string) {
  return `/community/${slug}?mediaUpload=failed`
}

/** Preserve already completed uploads on retry and continue in cover-then-icon order. */
export async function uploadRemainingCreationImages(
  groupId: string,
  selected: Partial<Record<CommunityMediaKind, File>>,
  completed: CommunityMediaKind[],
  upload: (groupId: string, kind: CommunityMediaKind, file: File) => Promise<void>,
): Promise<{ success: true } | { success: false; kind: CommunityMediaKind; file: File }> {
  for (const kind of ['cover', 'icon'] as const) {
    if (completed.includes(kind)) continue
    const file = selected[kind]
    if (!file) continue
    try {
      await upload(groupId, kind, file)
    } catch {
      return { success: false, kind, file }
    }
    completed.push(kind)
  }
  return { success: true }
}
