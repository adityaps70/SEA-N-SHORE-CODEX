/**
 * Window event that opens a profile's relationship "…" sheet (see RelationshipControls `openMenuEvent`).
 * Kept outside the 'use client' trigger module so server pages can compute the event name: a server
 * component may not call a function exported from a client module.
 */
export function relationshipMenuEventName(profileId: string) {
  return `sns:relationship-menu:${profileId}`
}
