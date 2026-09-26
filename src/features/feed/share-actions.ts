'use server'

import { randomUUID } from 'node:crypto'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { sendMessageAction, startDirectConversationAction } from '@/features/messaging/actions'
import { getNetworkHub } from '@/features/network/queries'
import { getPostById } from './queries'
import { sendPostInputSchema, shareRecipientSearchSchema } from './schemas'
import { composeSharedPostMessage, postShareUrl } from './share-message'

export type ShareRecipient = {
  id: string
  slug: string
  fullName: string
  avatarUrl: string | null
  detail: string
}

export type ShareRecipientsResult =
  | { ok: true; recipients: ShareRecipient[]; totalConnections: number }
  | { ok: false; error: string }

export type SendPostResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: string }

const RECIPIENT_LIMIT = 20

function recipientDetail(profile: { rank: string | null; currentCompany: string | null; headline: string | null }) {
  return [profile.rank, profile.currentCompany].filter(Boolean).join(' · ') || profile.headline || 'Maritime professional'
}

/** Accepted connections of the signed-in member that match the search text. */
export async function searchShareRecipients(query: string): Promise<ShareRecipientsResult> {
  const parsed = shareRecipientSearchSchema.safeParse({ query })
  if (!parsed.success) return { ok: false, error: 'Search with 80 characters or fewer.' }
  try {
    const hub = await getNetworkHub('connections', parsed.data.query)
    return {
      ok: true,
      totalConnections: hub.totalCount,
      recipients: hub.profiles.slice(0, RECIPIENT_LIMIT).map((profile) => ({
        id: profile.id,
        slug: profile.slug,
        fullName: profile.fullName,
        avatarUrl: profile.avatarUrl ?? null,
        detail: recipientDetail(profile),
      })),
    }
  } catch {
    return { ok: false, error: 'We could not load your connections. Check your internet connection and try again.' }
  }
}

/**
 * Sends a link to a feed post as a direct message. Messaging enforces that the recipient
 * is an accepted, unblocked connection; this action checks the post is visible to the sender.
 */
export async function sendPostToConnection(input: {
  postId: string
  recipientProfileId: string
  note?: string
}): Promise<SendPostResult> {
  const parsed = sendPostInputSchema.safeParse(input)
  if (!parsed.success) {
    const noteError = parsed.error.flatten().fieldErrors.note?.[0]
    return { ok: false, error: noteError ?? 'Choose a connection to send this post to.' }
  }

  const user = await requireAwsUser()
  if (parsed.data.recipientProfileId === user.id) {
    return { ok: false, error: 'Choose one of your connections. You cannot send a post to yourself.' }
  }

  const post = await getPostById(parsed.data.postId).catch(() => null)
  if (!post) return { ok: false, error: 'This post is no longer available to share.' }

  const conversation = await startDirectConversationAction(parsed.data.recipientProfileId)
  if (!conversation.ok) return { ok: false, error: conversation.error }

  const sent = await sendMessageAction({
    conversationId: conversation.conversationId,
    clientMessageId: randomUUID(),
    body: composeSharedPostMessage({
      note: parsed.data.note,
      authorName: post.author.fullName,
      url: await postShareUrl(post.id),
    }),
  })
  if (!sent.ok) return { ok: false, error: sent.error }
  return { ok: true, conversationId: conversation.conversationId }
}
