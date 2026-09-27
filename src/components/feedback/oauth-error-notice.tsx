const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  unavailable: 'Google sign-in is not available right now. Sign in with your email and password, or try Google again later.',
  verification: 'We could not verify the Google sign-in, which can happen if it took too long or was opened in another tab. Please try again.',
  exchange: 'Google sign-in could not be completed. Please try again, or sign in with your email and password.',
}

export function oauthErrorMessage(code: string | null | undefined) {
  if (!code) return null
  return OAUTH_ERROR_MESSAGES[code] ?? 'Google sign-in could not be completed. Please try again.'
}

/** Shows why a Google sign-in redirect came back to this page (`?oauthError=`). */
export function OAuthErrorNotice({ code }: { code: string | string[] | null | undefined }) {
  const message = oauthErrorMessage(Array.isArray(code) ? code[0] : code)
  if (!message) return null
  return (
    <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {message}
    </p>
  )
}
