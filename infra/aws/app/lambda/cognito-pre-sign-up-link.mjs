import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider'

// Round 14 (2.7): disposable / temporary email domains refused for self-service sign-up
// (PreSignUp_SignUp only). This Lambda ships as a single file, so the list is an exact copy of
// src/lib/auth/disposable-email.ts; a contract test fails when the two differ.
export const DISPOSABLE_EMAIL_DOMAINS = Object.freeze([
  '0-mail.com', '10mail.org', '10minemail.com', '10minutemail.co.uk', '10minutemail.com',
  '10minutemail.net', '1secmail.com', '1secmail.net', '1secmail.org', '20minutemail.com',
  '20minutemail.it', 'anonbox.net', 'anonymbox.com', 'armyspy.com', 'binkmail.com', 'bobmail.info',
  'burnermail.io', 'byom.de', 'chacuo.net', 'cool.fr.nf', 'correotemporal.org', 'courriel.fr.nf',
  'crazymailing.com', 'cuvox.de', 'dayrep.com', 'discard.email', 'discardmail.com',
  'discardmail.de', 'dispomail.eu', 'disposableaddress.com', 'disposableemailaddresses.com',
  'disposableinbox.com', 'dispose.it', 'dispostable.com', 'dodgeit.com', 'dodgit.com',
  'dropmail.me', 'dumpmail.de', 'easytrashmail.com', 'einrot.com', 'emailfake.com',
  'emailondeck.com', 'emailsensei.com', 'emailtemporanea.com', 'emailtemporanea.net',
  'emailtemporar.ro', 'emailtemporario.com.br', 'emltmp.com', 'fakeinbox.com', 'fakemail.fr',
  'fakemail.net', 'fakemailgenerator.com', 'filzmail.com', 'fleckens.hu', 'getairmail.com',
  'getnada.com', 'getonemail.com', 'grr.la', 'guerrillamail.biz', 'guerrillamail.com',
  'guerrillamail.de', 'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamailblock.com', 'gustr.com', 'harakirimail.com', 'hidemail.de', 'hulapla.de',
  'inboxbear.com', 'inboxkitten.com', 'incognitomail.com', 'incognitomail.org', 'jetable.com',
  'jetable.fr.nf', 'jetable.net', 'jetable.org', 'jourrapide.com', 'kasmail.com', 'klzlk.com',
  'koszmail.pl', 'kurzepost.de', 'lroid.com', 'mail-temp.com', 'mail-temporaire.fr', 'mail.tm',
  'mail7.io', 'mailcatch.com', 'maildrop.cc', 'maildu.de', 'mailexpire.com', 'mailforspam.com',
  'mailfreeonline.com', 'mailhazard.com', 'mailimate.com', 'mailin8r.com', 'mailinator.com',
  'mailinator.net', 'mailinator.org', 'mailinator2.com', 'mailmetrash.com', 'mailmoat.com',
  'mailnesia.com', 'mailnull.com', 'mailpoof.com', 'mailsac.com', 'mailscrap.com', 'mailshell.com',
  'mailslurp.com', 'mailtemp.info', 'mailtemporaire.com', 'mailtothis.com', 'mailzilla.com',
  'mega.zik.dj', 'meltmail.com', 'mintemail.com', 'moakt.cc', 'moakt.co', 'moakt.com',
  'mohmal.com', 'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf', 'mt2015.com', 'mvrht.com',
  'my10minutemail.com', 'mytemp.email', 'mytempemail.com', 'mytrashmail.com', 'nada.email',
  'neverbox.com', 'no-spam.ws', 'noclickemail.com', 'nomail.xl.cx', 'nospam.ze.tc', 'nospamfor.us',
  'nowmymail.com', 'objectmail.com', 'obobbo.com', 'onewaymail.com', 'owlpic.com', 'pokemail.net',
  'pookmail.com', 'proxymail.eu', 'put2.net', 'quickinbox.com', 'rcpt.at', 'receiveee.com',
  'rhyta.com', 'rmqkr.net', 'rppkn.com', 'safetymail.info', 'schafmail.de',
  'selfdestructingmail.com', 'sendspamhere.com', 'sharklasers.com', 'shieldemail.com',
  'shitmail.me', 'slopsbox.com', 'smellfear.com', 'snakemail.com', 'sneakemail.com',
  'sofimail.com', 'sogetthis.com', 'soodonims.com', 'spam.la', 'spam4.me', 'spamavert.com',
  'spambob.com', 'spambob.net', 'spambog.com', 'spambog.de', 'spambog.ru', 'spambox.us',
  'spamcero.com', 'spamday.com', 'spamex.com', 'spamfree24.com', 'spamfree24.de', 'spamfree24.org',
  'spamgourmet.com', 'spamherelots.com', 'spamhole.com', 'spaml.com', 'spammotel.com',
  'spamobox.com', 'spamspot.com', 'spamthis.co.uk', 'spamthisplease.com', 'speed.1s.fr',
  'superrito.com', 'suremail.info', 'teleworm.us', 'temp-mail.io', 'temp-mail.org', 'temp-mail.ru',
  'tempail.com', 'tempalias.com', 'tempe-mail.com', 'tempemail.co.za', 'tempemail.com',
  'tempemail.net', 'tempinbox.co.uk', 'tempinbox.com', 'tempm.com', 'tempmail.com', 'tempmail.de',
  'tempmail.dev', 'tempmail.it', 'tempmail.net', 'tempmail.us', 'tempmail2.com',
  'tempmailaddress.com', 'tempmailer.com', 'tempmailer.de', 'tempmailo.com', 'tempomail.fr',
  'temporaryemail.net', 'temporaryemail.us', 'temporaryforwarding.com', 'temporaryinbox.com',
  'temporarymailaddress.com', 'tempr.email', 'tempsky.com', 'thankyou2010.com',
  'thisisnotmyrealemail.com', 'throwam.com', 'throwawayemailaddress.com', 'throwawaymail.com',
  'tmail.ws', 'tmailinator.com', 'tmpmail.net', 'tmpmail.org', 'trash-mail.at', 'trash-mail.com',
  'trash-mail.de', 'trash2009.com', 'trashdevil.com', 'trashdevil.de', 'trashemail.de',
  'trashmail.at', 'trashmail.com', 'trashmail.de', 'trashmail.io', 'trashmail.me', 'trashmail.net',
  'trashmail.org', 'trashmail.ws', 'trashmailer.com', 'trashymail.com', 'trashymail.net',
  'trbvm.com', 'tyldd.com', 'uggsrock.com', 'venompen.com', 'veryrealemail.com', 'vomoto.com',
  'wegwerfadresse.de', 'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org', 'wh4f.org',
  'whyspam.me', 'willselfdestruct.com', 'wuzupmail.net', 'yepmail.net', 'yomail.info',
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'zetmail.com', 'zippymail.info', 'zoemail.org',
])

const DISPOSABLE_DOMAIN_SET = new Set(DISPOSABLE_EMAIL_DOMAINS)

export const DISPOSABLE_EMAIL_ERROR = 'disposable_email_blocked: Please use a permanent email address.'

/** True when the address (or a username that is an address) uses a listed domain or a subdomain of one. */
export function isDisposableEmail(value) {
  if (typeof value !== 'string') return false
  const at = value.lastIndexOf('@')
  if (at < 0) return false
  const labels = value.slice(at + 1).trim().toLowerCase().replace(/\.+$/, '').split('.')
  for (let index = 0; index < labels.length - 1; index += 1) {
    if (DISPOSABLE_DOMAIN_SET.has(labels.slice(index).join('.'))) return true
  }
  return false
}

function attribute(user, name) {
  return user?.Attributes?.find((item) => item?.Name === name)?.Value
}

function googleSubject(userName) {
  if (typeof userName !== 'string' || !userName.startsWith('Google_')) return null
  const value = userName.slice('Google_'.length).trim()
  return value || null
}

function normalizedVerifiedEmail(event) {
  const email = event?.request?.userAttributes?.email
  const verified = event?.request?.userAttributes?.email_verified
  if (verified !== 'true' || typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/.test(normalized)) return null
  return normalized
}

function isEligibleLocalUser(user) {
  if (!user?.Username || user?.Enabled === false || user?.UserStatus === 'EXTERNAL_PROVIDER') return false
  return attribute(user, 'email_verified') === 'true'
}

function filterValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function createHandler(input = {}) {
  const client = input.client ?? new CognitoIdentityProviderClient({})

  return async function handler(event) {
    // Self-service sign-up only. AdminCreateUser (phone-only members) and Google are never blocked.
    if (event?.triggerSource === 'PreSignUp_SignUp') {
      if (isDisposableEmail(event?.request?.userAttributes?.email) || isDisposableEmail(event?.userName)) {
        throw new Error(DISPOSABLE_EMAIL_ERROR)
      }
      return event
    }
    if (event?.triggerSource !== 'PreSignUp_ExternalProvider') return event

    const sourceSubject = googleSubject(event?.userName)
    const email = normalizedVerifiedEmail(event)
    const userPoolId = event?.userPoolId
    if (!sourceSubject || !email || typeof userPoolId !== 'string' || !userPoolId) return event

    const listed = await client.send(new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `email = "${filterValue(email)}"`,
      Limit: 10,
    }))

    const localUsers = (listed.Users ?? []).filter(isEligibleLocalUser)
    if (localUsers.length > 1) throw new Error('ambiguous_existing_account')
    if (localUsers.length === 0) return event

    await client.send(new AdminLinkProviderForUserCommand({
      UserPoolId: userPoolId,
      DestinationUser: {
        ProviderName: 'Cognito',
        ProviderAttributeValue: localUsers[0].Username,
      },
      SourceUser: {
        ProviderName: 'Google',
        ProviderAttributeName: 'Cognito_Subject',
        ProviderAttributeValue: sourceSubject,
      },
    }))

    return event
  }
}

export const handler = createHandler()
