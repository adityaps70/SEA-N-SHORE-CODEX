/** Plain-language copy for access-request failures, shared by the organization and admin actions. */
export function accessRequestErrorMessage(code: string): string {
  switch (code) {
    case 'company_access_request_not_found':
      return 'This request could not be found. It may have been withdrawn. Reload the page to see the latest requests.'
    case 'company_access_request_review_forbidden':
      return 'This request has already been decided. Reload the page to see the outcome.'
    case 'company_access_request_own':
      return 'You cannot decide your own request. Another owner or administrator of the organization needs to review it.'
    case 'company_access_request_escalated':
      return 'The requester asked Sea N Shore to review this request, so Sea N Shore will decide it.'
    case 'company_access_request_platform_read_only':
      return 'This organization still has an active owner or administrator, so they decide this request. Sea N Shore can step in after 7 days or if the requester escalates it.'
    case 'company_access_request_forbidden':
    case 'organization_access_forbidden':
      return 'Only the owner or an administrator of this organization can decide its access requests.'
    case 'company_access_request_role_invalid':
      return 'Choose a valid role to grant.'
    case 'company_access_request_already_escalated':
      return 'You have already asked Sea N Shore to review this request. We will update the status here.'
    case 'company_access_request_escalation_too_early':
      return 'The organization has 7 days to respond. You can ask Sea N Shore to step in after that.'
    case 'company_access_request_not_escalatable':
      return 'This request cannot be escalated. Sea N Shore decisions are final; you can send a new request instead.'
    case 'organization_access_request_exists':
      return 'You already have a newer request waiting for this organization and role.'
    case 'company_access_request_not_withdrawable':
      return 'Only requests that are still waiting can be withdrawn. Reload the page to see the latest status.'
    default:
      if (/authentication required/i.test(code)) return 'Your session has expired. Sign in again and retry.'
      return 'We could not save this change. Check your connection and try again.'
  }
}
