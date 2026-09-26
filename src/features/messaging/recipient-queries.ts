import { requireAwsUser } from '@/features/auth/aws-queries'
import { networkRepository } from '@/features/network/repository'
import { getAwsPublicProfileById, getAwsPublicProfilesByIds } from '@/features/profiles/aws-queries'
import { createProfileRepository } from '@/features/profiles/repository'
import { createMessageRecipientSearch } from './recipients'
import { messagingRepository } from './repository'

const profileRepository = createProfileRepository()

export const searchMessageRecipients = createMessageRecipientSearch({
  requireUser: requireAwsUser,
  loadViewerGraph: (viewerId) => networkRepository.loadViewerGraph(viewerId),
  loadProfiles: (input) => profileRepository.getPublicProfilesByIds(input),
  loadHydratedProfiles: (ids) => getAwsPublicProfilesByIds(ids),
  listDirectConversationsWithPeers: (viewerId, peerIds) => (
    messagingRepository.listDirectConversationsWithPeers(viewerId, peerIds)
  ),
})

/**
 * Peer details for a conversation that is not in the first page of the inbox
 * (for example one just created from New Message by a member with a long
 * inbox). The caller must already have confirmed the viewer is a participant.
 */
export async function getConversationPeer(viewerId: string, conversationId: string) {
  const peerId = await messagingRepository.findOtherParticipantId(conversationId, viewerId)
  if (!peerId) return null
  const profile = await getAwsPublicProfileById(peerId)
  return {
    otherProfileId: peerId,
    otherName: profile?.fullName ?? null,
    otherHeadline: profile
      ? [profile.rank, profile.currentCompany].filter(Boolean).join(' · ') || profile.headline
      : null,
    otherAvatarUrl: profile?.avatarUrl ?? null,
  }
}
