/**
 * Round G (G2): lazy entry points into People you may know for server actions, so the profile and
 * network action modules do not load the whole suggestions stack (and the profile repository) at
 * import time. Both are best effort: a failure never breaks the member's action.
 */
export async function refreshPeopleSuggestionsQuietly(viewerId: string) {
  try {
    const { peopleSuggestions } = await import('./people-suggestions')
    await peopleSuggestions.refreshQuietly(viewerId)
  } catch {
    // refreshQuietly already logs; an import failure leaves the nightly run to catch up.
  }
}

export async function removePeopleSuggestionPair(actorId: string, targetId: string, bothWays = false) {
  const { peopleSuggestions } = await import('./people-suggestions')
  await peopleSuggestions.removePair(actorId, targetId, bothWays)
}
