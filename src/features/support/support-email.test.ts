import { describe, expect, it } from 'vitest'
import { renderSupportEmail } from './support-email'
import { SUPPORT_OPERATIONS_EMAIL, supportTicketReference } from './topics'

const TICKET = '1a2b3c4d-1111-4111-8111-111111111111'
const base = {
  ticketId: TICKET,
  topic: 'account',
  senderName: 'Placeholder Sender',
  senderEmail: 'sender@example.com',
  body: 'Line one <script>alert(1)</script>\n\nLine two',
  siteUrl: 'https://example.com',
}

describe('support ticket emails (round H, H7)', () => {
  it('sends a new request to operations with a link to answer in Admin', () => {
    const email = renderSupportEmail({ ...base, kind: 'operations_new_ticket', signedIn: false })
    expect(supportTicketReference(TICKET)).toBe('SNS-1A2B3C4D')
    expect(email.to).toBe(SUPPORT_OPERATIONS_EMAIL)
    expect(email.subject).toBe('[SNS-1A2B3C4D] New request: Account and sign-in')
    expect(email.text).toContain('Placeholder Sender <sender@example.com> (visitor, not signed in)')
    expect(email.text).toContain(`https://example.com/admin/support/${TICKET}`)
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.replyTo).toBeUndefined()
  })

  it('names a member reply for operations', () => {
    const email = renderSupportEmail({ ...base, kind: 'operations_member_reply', signedIn: true })
    expect(email.subject).toBe('[SNS-1A2B3C4D] Reply: Account and sign-in')
    expect(email.text).toContain('(signed-in member)')
  })

  it('sends an answer to a member with a link to My requests, and to a visitor with reply-to operations', () => {
    const member = renderSupportEmail({ ...base, kind: 'sender_admin_reply', signedIn: true, body: 'Placeholder answer.' })
    expect(member.to).toBe('sender@example.com')
    expect(member.subject).toBe('Re: your Sea N Shore request SNS-1A2B3C4D')
    expect(member.text).toContain(`https://example.com/help/requests/${TICKET}`)
    expect(member.replyTo).toBeUndefined()

    const visitor = renderSupportEmail({ ...base, kind: 'sender_admin_reply', signedIn: false, body: 'Placeholder answer.' })
    expect(visitor.text).toContain('To answer, reply to this email.')
    expect(visitor.text).not.toContain('/help/requests/')
    expect(visitor.replyTo).toBe(SUPPORT_OPERATIONS_EMAIL)
  })

  it('never lets the sender name break a header line', () => {
    const email = renderSupportEmail({ ...base, kind: 'sender_admin_reply', signedIn: false, senderName: 'Placeholder\r\nBcc: x@example.com' })
    expect(email.text.split('\n')[0]).toBe('Hello Placeholder Bcc: x@example.com,')
  })
})
