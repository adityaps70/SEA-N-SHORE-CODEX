import { MessageCircleMore } from 'lucide-react'
import { StartConversationButton } from '@/features/messaging/components/start-conversation-button'

/**
 * Message an applicant from the hiring review page. Sea N Shore messaging is limited to accepted
 * connections (messaging service rule), so without a connection the button is disabled and says why.
 */
export function MessageApplicantButton({
  targetProfileId,
  candidateName,
  canMessage,
}: {
  targetProfileId: string
  candidateName: string
  canMessage: boolean
}) {
  if (canMessage) {
    return (
      <div className="inline-block min-w-0" data-testid="message-applicant">
        <StartConversationButton targetProfileId={targetProfileId} className="rounded-xl" />
      </div>
    )
  }
  const reasonId = `message-applicant-reason-${targetProfileId}`
  return (
    <div className="min-w-0" data-testid="message-applicant">
      <button
        type="button"
        disabled
        aria-describedby={reasonId}
        className="inline-flex min-h-10 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-mist-200 bg-mist-50 px-4 text-sm font-semibold text-muted"
      >
        <MessageCircleMore aria-hidden="true" className="size-4" />
        Message
      </button>
      <p id={reasonId} className="mt-1.5 max-w-xs text-xs leading-5 text-muted">
        Connect with {candidateName} to message them. Messages are open to accepted connections only.
      </p>
    </div>
  )
}
