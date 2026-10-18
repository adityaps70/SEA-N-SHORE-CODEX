import { pluralize } from '@/lib/format'

/** Round H: course owner replies to reviews. Shared by the server and the reply form (no server imports here). */

/** The longest owner reply (the database check allows the same). */
export const REVIEW_REPLY_MAX_LENGTH = 2000

/** The reply form's counter: "1 character left", "2000 characters left", "3 characters over the limit". */
export function replyCharactersLeft(length: number, max = REVIEW_REPLY_MAX_LENGTH) {
  const left = max - length
  return left < 0 ? `${pluralize(-left, 'character')} over the limit` : `${pluralize(left, 'character')} left`
}
