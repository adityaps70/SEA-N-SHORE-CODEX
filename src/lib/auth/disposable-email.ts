/**
 * Round 14 (2.7): well-known disposable / temporary email domains. A sign-up address on one of
 * these domains, or on any subdomain of one, is refused (case-insensitive).
 *
 * The Cognito pre-sign-up Lambda (infra/aws/app/lambda/cognito-pre-sign-up-link.mjs) is deployed
 * as a single file, so it carries an identical copy of this list; a contract test
 * (disposable-email.test.ts) fails when the two differ. Change both together, keeping them sorted.
 *
 * Only blocks self-service email sign-up. Phone-only members (synthetic phone-...@auth.seaandshore.in
 * addresses created with AdminCreateUser) and Google sign-ups are never checked against it.
 */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = Object.freeze([
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

const DOMAIN_SET: ReadonlySet<string> = new Set(DISPOSABLE_EMAIL_DOMAINS)

/** The lower-cased domain of an email address (after the last "@"), or null. */
export function emailDomain(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const at = email.lastIndexOf('@')
  if (at < 0) return null
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.+$/, '')
  return domain || null
}

/** True when the domain is a listed disposable domain or a subdomain of one. */
export function isDisposableEmailDomain(domain: unknown): boolean {
  if (typeof domain !== 'string') return false
  const labels = domain.trim().toLowerCase().replace(/\.+$/, '').split('.')
  for (let index = 0; index < labels.length - 1; index += 1) {
    if (DOMAIN_SET.has(labels.slice(index).join('.'))) return true
  }
  return false
}

/** True when the address uses a disposable email domain (or a subdomain of one). */
export function isDisposableEmail(email: unknown): boolean {
  const domain = emailDomain(email)
  return domain ? isDisposableEmailDomain(domain) : false
}
