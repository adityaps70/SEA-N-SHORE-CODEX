export async function handler(event) {
  const session = Array.isArray(event.request?.session) ? event.request.session : []
  const last = session.at(-1)

  event.response.issueTokens = false
  event.response.failAuthentication = false

  if (last?.challengeName === 'CUSTOM_CHALLENGE' && last.challengeResult === true) {
    event.response.issueTokens = true
    return event
  }

  if (session.length >= 3) {
    event.response.failAuthentication = true
    return event
  }

  event.response.challengeName = 'CUSTOM_CHALLENGE'
  return event
}
