import { describe, expect, it } from 'vitest'
import { activityEmail, messageDigestEmail } from './emails'

/** Round H (H3): plain, accessible activity emails with a text part and RFC 8058 one-click unsubscribe headers. */
const siteUrl = 'https://seanshore.example'
const token = 'payload.signature'

describe('activity emails', () => {
  it('carry the footer link and the List-Unsubscribe and List-Unsubscribe-Post headers for their own type', () => {
    const email = activityEmail({ type: 'post_comment', actorName: 'Placeholder Sailor', postId: 'post-1', commentId: 'comment-1', token, siteUrl })
    expect(email.subject).toBe('Placeholder Sailor commented on your post')
    expect(email.headers).toEqual([
      { Name: 'List-Unsubscribe', Value: `<${siteUrl}/api/email/notifications/unsubscribe?token=payload.signature>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ])
    expect(email.html).toContain(`href="${siteUrl}/email/notifications/unsubscribe?token=payload.signature"`)
    expect(email.html).toContain('Turn off comment emails')
    expect(email.html).toContain('<html lang="en">')
    expect(email.html).toContain(`href="${siteUrl}/posts/post-1#comment-comment-1"`)
    expect(email.text).toContain(`View the comment: ${siteUrl}/posts/post-1#comment-comment-1`)
    expect(email.text).toContain(`Turn off comment emails: ${siteUrl}/email/notifications/unsubscribe?token=payload.signature`)
    expect(email.text).toContain(`${siteUrl}/settings/notifications`)
  })

  it('names the right action and destination for each notification type', () => {
    const cases = [
      ['connection_request', 'wants to connect with you on Sea N Shore', '/network?tab=requests', 'connection request emails'],
      ['comment_reply', 'replied to your comment', '/posts/post-1#comment-comment-1', 'comment emails'],
      ['post_mention', 'mentioned you in a post', '/posts/post-1"', 'mention and tag emails'],
      ['comment_mention', 'mentioned you in a comment', '/posts/post-1#comment-comment-1', 'mention and tag emails'],
      ['photo_tag', 'tagged you in a photo', '/posts/post-1"', 'mention and tag emails'],
    ] as const
    for (const [type, did, path, turnOff] of cases) {
      const email = activityEmail({ type, actorName: 'Placeholder Sailor', postId: 'post-1', commentId: type === 'post_mention' || type === 'photo_tag' ? null : 'comment-1', token, siteUrl })
      expect(email.subject).toBe(`Placeholder Sailor ${did}`)
      expect(email.html).toContain(`${siteUrl}${path}`)
      expect(email.text).toContain(`Turn off ${turnOff}`)
    }
  })

  it('escapes member names and keeps them on one bounded line', () => {
    const email = activityEmail({ type: 'post_mention', actorName: '<script>alert(1)</script>\r\nBcc: x@example.com', postId: 'post-1', commentId: null, token, siteUrl })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.subject).not.toMatch(/[\r\n]/)
    const long = activityEmail({ type: 'post_mention', actorName: 'A'.repeat(200), postId: 'post-1', commentId: null, token, siteUrl })
    expect(long.subject.length).toBeLessThan(140)
    expect(activityEmail({ type: 'post_mention', actorName: null, postId: 'post-1', commentId: null, token, siteUrl }).subject).toBe('A Sea N Shore member mentioned you in a post')
  })
})

describe('unread messages digest email', () => {
  it('says how many and from whom, never what the messages say, with its own unsubscribe', () => {
    const email = messageDigestEmail({ unreadCount: 5, conversationCount: 3, senderNames: ['Sailor A', 'Sailor B', 'Sailor C'], senderCount: 4, token, siteUrl })
    expect(email.subject).toBe('You have 5 unread messages on Sea N Shore')
    expect(email.text).toContain('You have 5 unread messages in 3 conversations from Sailor A, Sailor B, Sailor C and 1 other.')
    expect(email.text).toContain('message text is never included')
    expect(email.text).toContain(`Open Messages: ${siteUrl}/messages`)
    expect(email.text).toContain('Turn off unread message emails')
    expect(email.headers[1]).toEqual({ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' })
  })

  it('reads naturally for one message from one person', () => {
    const email = messageDigestEmail({ unreadCount: 1, conversationCount: 1, senderNames: ['Sailor A'], senderCount: 1, token, siteUrl })
    expect(email.subject).toBe('You have 1 unread message on Sea N Shore')
    expect(email.text).toContain('You have 1 unread message from Sailor A.')
  })
})
