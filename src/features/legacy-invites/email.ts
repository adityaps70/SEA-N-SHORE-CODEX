import { publicEnvironment } from '@/lib/env'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] ?? character)
}

export const LEGACY_INVITE_FROM = 'Sea N Shore <accounts@mail.seanshore.in>'

export function legacyInviteEmail(input: { fullName: string; claimToken: string; siteUrl?: string }) {
  const siteUrl = (input.siteUrl ?? publicEnvironment.NEXT_PUBLIC_SITE_URL).replace(/\/+$/g, '')
  const claimUrl = `${siteUrl}/auth/claim-profile?invite=${encodeURIComponent(input.claimToken)}`
  const name = input.fullName.trim() || 'Sea N Shore member'
  const subject = 'Your Sea N Shore profile is ready to reclaim'
  const text = [
    `Hello ${name},`,
    '',
    'You previously registered on the Sea N Shore website. Sea N Shore has now been rebuilt on a new platform, and we restored useful profile information where reliable legacy data was available.',
    '',
    'Your old password was not moved. To reconnect your profile, open the secure link below and verify the same email address you used on the old Sea N Shore website:',
    claimUrl,
    '',
    'After verification, you can review and update the restored information on your current profile. If you already have a current Sea N Shore account, the current account remains in control and duplicate profiles are avoided.',
    '',
    'The new Sea N Shore brings professional networking, maritime jobs, messaging, learning, events and communities together in one place.',
    '',
    'This is an account-reconnection notice because this email address was registered on the previous Sea N Shore website.',
    '',
    'Sea N Shore',
  ].join('\n')

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f5f8fa;font-family:Arial,sans-serif;color:#123047">
    <div style="max-width:640px;margin:0 auto;padding:32px 18px">
      <div style="background:#fff;border:1px solid #dce8ef;border-radius:18px;padding:32px">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.12em;color:#16789d">SEA N SHORE</p>
        <h1 style="margin:0 0 18px;font-size:28px;line-height:1.15;color:#0d3047">Your Sea N Shore profile is ready to reclaim</h1>
        <p style="font-size:16px;line-height:1.65">Hello ${escapeHtml(name)},</p>
        <p style="font-size:16px;line-height:1.65">You previously registered on the Sea N Shore website. Sea N Shore has now been rebuilt on a new platform, and we restored useful profile information where reliable legacy data was available.</p>
        <p style="font-size:16px;line-height:1.65"><strong>Your old password was not moved.</strong> Verify the same email address you used on the old website to reconnect your restored profile.</p>
        <p style="margin:26px 0"><a href="${escapeHtml(claimUrl)}" style="display:inline-block;background:#08789e;color:#fff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:10px">Reclaim my Sea N Shore profile</a></p>
        <p style="font-size:15px;line-height:1.65">After verification, you can review and update your recovered details. If you already have a current Sea N Shore account, that account remains in control and duplicate profiles are avoided.</p>
        <div style="margin:24px 0;padding:18px;border-radius:12px;background:#f2f8fb">
          <strong>What is on the new Sea N Shore?</strong>
          <p style="margin:8px 0 0;line-height:1.6">Professional networking · Maritime jobs · Messaging · Learning · Events · Communities</p>
        </div>
        <p style="margin-top:28px;font-size:12px;line-height:1.6;color:#667987">This is an account-reconnection notice because this email address was registered on the previous Sea N Shore website.</p>
      </div>
    </div>
  </body>
</html>`

  return { subject, text, html, claimUrl }
}
