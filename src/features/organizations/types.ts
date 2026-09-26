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

export type CompanyAccessRequestSummary = {
  id: string
  status: CompanyAccessRequestStatus
  requestedRole: CompanyAccessRequestRole
  requestType: CompanyAccessRequestType
  message: string | null
  requestedAt: string
  reviewedAt: string | null
  reviewerNote: string | null
  company: OrganizationCompanySummary
}

export type OrganizationApplicationInput = {
  organizationName: string
  organizationType: string
  website: string | null
  officialEmail: string
  officeLocation: string
  description: string
  fleetSummary: string | null
  vesselTypes: string[]
  applicantRole: string
  registrationReference: string | null
  supportingNotes: string | null
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
  companyType: string | null
  verified: boolean
  website: string | null
}
