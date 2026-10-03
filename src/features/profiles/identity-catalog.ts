import type { ProfileType } from './types'

export const IDENTITY_ROOTS = ['professional', 'organisation'] as const
export type IdentityRoot = (typeof IDENTITY_ROOTS)[number]

export type IdentityOption = {
  root: IdentityRoot
  family: string
  label: string
}

export const professionalGroups = {
  "Sea-going · Deck": ["Master", "Chief Officer", "Second Officer", "Third Officer", "Junior Deck Officer", "Deck Cadet", "Bosun", "Able Seafarer Deck", "Able Seaman", "Ordinary Seaman", "Deck Rating", "Pumpman", "Cargo Officer", "Shipboard Safety Officer"],
  "Sea-going · Engine": ["Chief Engineer", "Second Engineer", "Third Engineer", "Fourth Engineer", "Junior Engineer", "Engine Cadet", "Fitter", "Motorman", "Oiler", "Wiper", "Engine Rating", "Refrigeration Engineer", "Engine Storekeeper"],
  "Sea-going · Electrical": ["Electro-Technical Officer", "Electro-Technical Rating", "Electrical Engineer", "Electrical Cadet", "Electronics Engineer", "Communication Officer"],
  "Shipboard · Hotel & Medical": ["Chief Cook", "Cook", "Steward", "Chief Steward", "Purser", "Hotel Manager", "Restaurant Manager", "Housekeeping Officer", "Medical Officer", "Shipboard Nurse", "Ship Security Officer"],
  "Offshore & Subsea": ["Offshore Installation Manager", "Barge Master", "Dynamic Positioning Operator", "Senior Dynamic Positioning Operator", "Offshore Marine Superintendent", "Offshore Installation Engineer", "Drilling Superintendent", "Drilling Engineer", "Toolpusher", "Roustabout", "Rigger", "Offshore Crane Operator", "ROV Pilot Technician", "Subsea Engineer", "Offshore HSE Manager", "Marine Warranty Surveyor"],
  "Ship Management & Operations": ["Marine Superintendent", "Technical Superintendent", "Fleet Manager", "Fleet Director", "Technical Manager", "Technical Director", "Marine Operations Manager", "Vessel Manager", "Crewing Manager", "Crew Superintendent", "Fleet Personnel Manager", "Procurement Manager", "Purchasing Manager", "Designated Person Ashore (DPA)", "Company Security Officer (CSO)", "QHSE Manager", "HSSEQ Superintendent", "Marine Assurance Manager", "Vetting Superintendent", "Port Captain", "Newbuilding Superintendent", "Dry Dock Superintendent", "Energy Efficiency Manager", "Environmental Compliance Manager", "Decarbonisation Manager"],
  "Commercial Shipping": ["Chartering Manager", "Charterer", "Shipbroker", "Sale & Purchase Broker", "Freight Trader", "Commercial Manager", "Post-Fixture Executive", "Demurrage Analyst", "Voyage Operator", "Ship Operator", "Cargo Operator", "Bunker Trader", "Bunker Buyer", "Maritime Economist", "Shipping Analyst"],
  "Survey, Class & Assurance": ["Marine Surveyor", "Cargo Surveyor", "Hull Surveyor", "Machinery Surveyor", "Condition Surveyor", "Pre-purchase Surveyor", "Class Surveyor", "Flag State Surveyor", "P&I Surveyor", "Vetting Inspector", "SIRE Inspector", "ISM Auditor", "ISPS Auditor", "Maritime Auditor"],
  "Ports & Terminals": ["Marine Pilot", "Harbour Master", "Deputy Harbour Master", "Port Operations Manager", "Terminal Manager", "Marine Terminal Superintendent", "Berth Planner", "VTS Operator", "Mooring Master", "Loading Master", "Port Facility Security Officer", "Port Engineer", "Port Planner", "Port Marine Superintendent"],
  "Legal, Insurance & Finance": ["Maritime Lawyer", "Admiralty Lawyer", "P&I Claims Executive", "P&I Claims Manager", "Marine Insurance Broker", "Marine Underwriter", "Average Adjuster", "Claims Surveyor", "Maritime Arbitrator", "Maritime Mediator", "Sanctions Compliance Specialist", "Maritime Finance Professional", "Ship Finance Analyst"],
  "Training, Research & Human Factors": ["Maritime Trainer", "Nautical Instructor", "Engineering Instructor", "Simulator Instructor", "STCW Assessor", "Maritime Academy Faculty", "Maritime Researcher", "Naval Architect", "Oceanographer", "Maritime Historian", "Maritime Psychologist", "Human Factors Specialist", "Maritime Safety Researcher"],
  "Technology, Data & Logistics": ["Maritime Software Product Manager", "Maritime Software Engineer", "Maritime Data Analyst", "Maritime Cybersecurity Specialist", "Fleet Performance Analyst", "Vessel Performance Engineer", "Satellite Communications Specialist", "Navigation Technology Specialist", "Freight Forwarder", "NVOCC Professional", "Logistics Manager", "Multimodal Transport Specialist", "Ship Agent", "Port Agent", "Customs Broker", "Maritime AI Specialist"],
  "Recruitment, Welfare & Public Sector": ["Maritime Recruiter", "Crewing Recruiter", "Maritime HR Professional", "Seafarer Welfare Professional", "Union Representative", "Maritime NGO Professional", "Government Maritime Officer", "Flag Administration Officer", "Port State Control Officer", "Coast Guard Officer", "Maritime Policymaker", "Classification Society Manager", "Maritime Regulator"],
  "Professional Capacities": ["Mentor", "Maritime Consultant", "Maritime Entrepreneur", "Maritime Speaker", "Maritime Author", "Maritime Content Creator", "Industry Advisor", "Board Advisor"],
} as const

export const organisationGroups = {
  "Shipping & Ship Management": ["Shipowner", "Ship Operator Company", "Technical Ship Manager", "Third-Party Ship Manager", "Crew Management Company", "Commercial Ship Manager", "Bareboat Charterer", "Time Charterer", "Voyage Charterer", "Cargo Owner / Shipper"],
  "Manning & Recruitment": ["Manning Agency", "Recruitment & Placement Service", "RPSL Agency", "Maritime Recruitment Company", "Crew Travel Company"],
  "Ports & Terminals": ["Port Authority", "Port Operator", "Container Terminal", "Bulk Terminal", "Oil Terminal", "LNG Terminal", "Cruise Terminal", "Dry Port / ICD", "Pilotage Organisation", "Towage Company", "Mooring Company"],
  "Classification & Government": ["Classification Society", "Recognised Organisation", "Flag Administration", "Ship Registry", "Port State Control Authority", "Maritime Administration", "Customs Authority", "Immigration Authority", "Coast Guard", "Maritime Safety Authority"],
  "Training & Knowledge": ["Maritime Academy", "Maritime University", "Maritime Training Institute", "STCW Training Centre", "Simulator Centre", "Competency Assessment Centre", "Maritime Research Institute", "Maritime Publisher / Media", "Seafarer Welfare Centre"],
  "Insurance, Legal & Finance": ["P&I Club", "Hull & Machinery Insurer", "Marine Insurance Broker", "Marine Claims Company", "Average Adjusting Firm", "Maritime Law Firm", "Ship Finance Institution", "Maritime Investment Fund", "Marine Risk Consultancy"],
  "Shipbuilding & Technical": ["Shipyard", "Ship Repair Yard", "Dry Dock", "Marine Engineering Company", "Marine OEM", "Engine Manufacturer", "Navigation Equipment Supplier", "Marine Automation Company", "Marine Electrical Company", "BWTS Provider", "Scrubber Provider", "Marine Electronics Company", "Newbuilding Consultancy"],
  "Fuel, Energy & Environment": ["Bunker Supplier", "Bunker Trading Company", "LNG Fuel Supplier", "Marine Lubricant Supplier", "Alternative Fuel Provider", "Marine Energy Company", "Decarbonisation Consultancy", "Maritime Environmental Consultancy", "Waste Reception Facility"],
  "Survey, Inspection & Compliance": ["Marine Survey Company", "Cargo Survey Company", "Vetting Company", "Marine Audit Company", "Inspection Company", "Testing Laboratory", "NDT Company", "Marine Warranty Survey Company"],
  "Technology & Communications": ["Maritime Software Company", "Fleet Management Software Company", "Navigation Technology Company", "Maritime AI Company", "Maritime Cybersecurity Company", "Satellite Communications Company", "Weather Intelligence Company", "Maritime Data Provider", "Vessel Tracking Company", "Digital Training Platform"],
  "Agency, Logistics & Port Services": ["Ship Agency", "Port Agency", "Freight Forwarding Company", "NVOCC", "Multimodal Logistics Provider", "Warehouse Operator", "Inland Transport Operator", "Ship Chandlery", "Fresh Water Supplier", "Launch Service", "Salvage Company"],
  "Industry Bodies & Community": ["Professional Maritime Association", "Seafarer Union", "Shipowner Association", "Chamber of Shipping", "Maritime NGO", "Seafarer Welfare Organisation", "Maritime Foundation", "Industry Body", "Maritime Cluster", "Maritime Startup Incubator"],
} as const

function flattenGroups(
  root: IdentityRoot,
  groups: Readonly<Record<string, readonly string[]>>,
): IdentityOption[] {
  return Object.entries(groups).flatMap(([family, labels]) =>
    labels.map((label) => ({ root, family, label })),
  )
}

export const professionalIdentities = flattenGroups('professional', professionalGroups)
export const organisationIdentities = flattenGroups('organisation', organisationGroups)

export function identityOptionsForRoot(root: IdentityRoot): IdentityOption[] {
  return root === 'professional' ? professionalIdentities : organisationIdentities
}

export function findIdentityOption(root: IdentityRoot, label: string): IdentityOption | undefined {
  const normalized = label.trim().toLocaleLowerCase()
  return identityOptionsForRoot(root).find(
    (option) => option.label.toLocaleLowerCase() === normalized,
  )
}

export function searchIdentityOptions(
  root: IdentityRoot,
  query: string,
  limit = 20,
): IdentityOption[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const options = identityOptionsForRoot(root)
  if (tokens.length === 0) return options.slice(0, limit)

  return options
    .filter((option) => {
      const haystack = `${option.label} ${option.family}`.toLocaleLowerCase()
      return tokens.every((token) => haystack.includes(token))
    })
    .sort((left, right) => {
      const q = query.trim().toLocaleLowerCase()
      const leftLabel = left.label.toLocaleLowerCase()
      const rightLabel = right.label.toLocaleLowerCase()
      const leftScore = leftLabel === q ? 0 : leftLabel.startsWith(q) ? 1 : leftLabel.includes(q) ? 2 : 3
      const rightScore = rightLabel === q ? 0 : rightLabel.startsWith(q) ? 1 : rightLabel.includes(q) ? 2 : 3
      return leftScore - rightScore || left.label.localeCompare(right.label)
    })
    .slice(0, limit)
}

export function legacyProfileTypeForIdentity(
  root: IdentityRoot,
  label: string,
  family: string,
): ProfileType {
  if (root === 'organisation') return 'company'
  if (label === 'Mentor') return 'mentor'
  if (label === 'Maritime Recruiter' || label === 'Crewing Recruiter') return 'recruiter'
  if (
    family.startsWith('Sea-going') ||
    family.startsWith('Shipboard') ||
    family === 'Offshore & Subsea'
  ) {
    return 'seafarer'
  }
  return 'maritime_professional'
}
