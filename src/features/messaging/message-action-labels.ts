/**
 * Round H (H8): accessible names for the per-message buttons. They say whose message it is ("Reply to
 * Placeholder Member's message", "React to your message"), never the message id, which a screen reader
 * would read out digit by digit.
 */
export type MessageAction = 'reply' | 'react' | 'more' | 'options'

const ACTION_PREFIX: Record<MessageAction, string> = {
  reply: 'Reply to',
  react: 'React to',
  more: 'More actions for',
  options: 'Options for',
}

/** "Placeholder Member's message", or "your message" for the viewer's own. */
export function messageOwnerPhrase({ mine, senderName }: { mine: boolean; senderName: string | null }) {
  if (mine) return 'your message'
  const name = senderName?.trim() || 'Sea N Shore member'
  return `${name}'s message`
}

export function messageActionLabel(action: MessageAction, owner: { mine: boolean; senderName: string | null }) {
  return `${ACTION_PREFIX[action]} ${messageOwnerPhrase(owner)}`
}
