/**
 * Owner (19 Nov, refresh recovery): a request header that only the proxy sets, on a request whose sign-in it has just
 * renewed (or recovered) before passing the request on with the new tokens. The session check then knows that the
 * new access token came from the server, not from the device, so that request does not count as the device having
 * received the renewal (session-guard, refresh-token-ledger).
 *
 * src/proxy.ts removes any copy a browser sends, on every request, so it cannot be forged. Even a forged one could
 * only delay the "renewal seen" mark; it never lets a request in.
 */
export const SESSION_RENEWED_HEADER = 'x-sns-session-renewed'

export function wasRenewedInRequest(headers: Pick<Headers, 'get'>) {
  return headers.get(SESSION_RENEWED_HEADER) === '1'
}
