export const ORGANIZATION_APPLICATION_STATUSES = [
  'pending',
  'changes_requested',
  'approved',
  'rejected',
  'suspended',
] as const

export type OrganizationApplicationStatus = (typeof ORGANIZATION_APPLICATION_STATUSES)[number]

export const COMPANY_ACCESS_REQUEST_TYPES = ['join_company', 'recruiter_access', 'role_access'] as const
export type CompanyAccessRequestType = (typeof COMPANY_ACCESS_REQUEST_TYPES)[number]

export const COMPANY_ACCESS_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const
export type CompanyAccessRequestStatus = (typeof COMPANY_ACCESS_REQUEST_STATUSES)[number]

export const COMPANY_ACCESS_REQUEST_ROLES = [
  'member',
  'recruiter',
  'administrator',
  'lms_manager',
  'event_manager',
  'content_manager',
  'analyst',
] as const
export type CompanyAccessRequestRole = (typeof COMPANY_ACCESS_REQUEST_ROLES)[number]

export type CompanyAccessDecidedVia = 'organization' | 'platform'

export type CompanyAccessRequestSummary = {
  id: string
  status: CompanyAccessRequestStatus
  requestedRole: CompanyAccessRequestRole
  /** Role actually granted on approval; can differ from the requested role. */
  grantedRole: CompanyAccessRequestRole | null
  requestType: CompanyAccessRequestType
  message: string | null
  requestedAt: string
  reviewedAt: string | null
  reviewerNote: string | null
  decidedVia: CompanyAccessDecidedVia | null
  escalatedAt: string | null
  escalationNote: string | null
  company: OrganizationCompanySummary
}

export type OrganizationApplicationInput = {
  organizationName: string
  /** Organization type code from organization-types.ts. Older free-text values are mapped on parse. */
  organizationType: string
  /** Free-text description, required when the type is "other". */
  organizationTypeOther?: string | null
  website: string | null
  officialEmail: string
  officeLocation: string
  description: string
  fleetSize?: number | null
  fleetSummary: string | null
  vesselTypes: string[]
  recruitmentLicence?: string | null
  servicesOffered?: string[]
  languages?: string[]
  helpline24x7?: boolean | null
  accreditation?: string | null
  applicantRole: string
  registrationReference: string | null
  supportingNotes: string | null
}

/** Type-specific details stored in companies.organization_details. */
export type OrganizationDetails = {
  fleetSize?: number
  recruitmentLicence?: string
  servicesOffered?: string[]
  languages?: string[]
  helpline24x7?: boolean
  accreditation?: string
}

export type OrganizationCompanySummary = {
  id: string
  slug: string
  name: string
  verified: boolean
}

export type OrganizationMembershipSummary = {
  role: string
  approvedAt: string | null
}

export type UserOrganizationState =
  | { kind: 'none' }
  | {
      kind: 'application'
      applicationId: string
      status: OrganizationApplicationStatus
      submittedAt: string
      updatedAt: string
      adminReviewNote: string | null
      company: OrganizationCompanySummary
      membership: OrganizationMembershipSummary | null
    }

export type CompanySearchResult = {
  id: string
  slug: string
  name: string
  /** Display label for the organization type (resolved from the type code when present). */
  companyType: string | null
  verified: boolean
  /** An unclaimed page added by someone who works there; nobody can approve join requests. */
  unclaimed?: boolean
  website: string | null
}
