import type { Persona } from '@/features/profiles/persona'

/**
 * The one list of departments and ranks / roles (round 12). Every screen that asks for a rank or a
 * role, the job form, the jobs filters and matching use these keys, so "Captain", "Master" and
 * "Master Mariner" are the same thing everywhere.
 *
 * Keys are stable snake_case: never shown, never renamed after release. A new rank is a new entry
 * here, not a database migration. Ladder levels: lower number = more senior, compared only inside
 * one ladder (officers and ratings are separate ladders).
 */

export type RoleDomain = 'sea' | 'shore'

export type RoleDepartment = {
  key: string
  label: string
  domain: RoleDomain
}

export type RoleEntry = {
  key: string
  label: string
  department: string
  /** Roles on the same ladder can be compared by level. */
  ladder: string
  level: number
  synonyms: readonly string[]
  /** The same job under another department (for example Crewing Manager under Recruitment / HR). */
  sameAs?: string
  /** "Other (type your own)": stores a short text and never scores. */
  other?: boolean
}

type RoleSeed = [key: string, label: string, ladder: string, level: number, synonyms?: readonly string[], sameAs?: string]

const SEA_DEPARTMENTS = [
  { key: 'deck_officers', label: 'Deck officers' },
  { key: 'deck_ratings', label: 'Deck ratings' },
  { key: 'engine_officers', label: 'Engine officers' },
  { key: 'engine_ratings', label: 'Engine ratings' },
  { key: 'catering', label: 'Catering / Hotel' },
  { key: 'specialist_offshore', label: 'Specialist / Offshore' },
] as const

const SHORE_DEPARTMENTS = [
  { key: 'technical_fleet', label: 'Technical & Fleet' },
  { key: 'hseq_vetting', label: 'HSEQ & Vetting' },
  { key: 'operations_commercial', label: 'Operations & Commercial' },
  { key: 'crewing_manning', label: 'Crewing & Manning' },
  { key: 'port_terminal_logistics', label: 'Port, Terminal & Logistics' },
  { key: 'survey_class_legal_insurance', label: 'Survey, Class, Legal & Insurance' },
  { key: 'shipyard_engineering', label: 'Shipyard & Engineering' },
  { key: 'management', label: 'Management' },
] as const

const RECRUITER_DEPARTMENTS = [{ key: 'recruitment_hr', label: 'Recruitment / HR' }] as const
const TRAINER_DEPARTMENTS = [{ key: 'training', label: 'Training' }] as const

const ROLE_SEEDS: Record<string, readonly RoleSeed[]> = {
  deck_officers: [
    ['master', 'Master / Captain', 'deck_officer', 1, ['Captain', 'Master Mariner', 'Master', 'Capt', 'Capt.', 'Ship Master', 'Shipmaster']],
    ['chief_officer', 'Chief Officer', 'deck_officer', 2, ['Chief Mate', 'C/O', 'CO', 'First Officer', 'First Mate', 'Chief Off']],
    ['second_officer', 'Second Officer', 'deck_officer', 3, ['2nd Officer', '2/O', '2nd Mate', 'Second Mate', '2 O', '2nd Off']],
    ['third_officer', 'Third Officer', 'deck_officer', 4, ['3rd Officer', '3/O', '3rd Mate', 'Third Mate', '3rd Off']],
    ['junior_deck_officer', 'Junior Officer / Fourth Officer', 'deck_officer', 5, ['Junior Officer', 'Fourth Officer', '4th Officer', '4/O', 'Junior Deck Officer', '4th Mate']],
    ['deck_cadet', 'Deck Cadet / Trainee Officer', 'deck_officer', 6, ['Deck Cadet', 'Trainee Officer', 'Trainee Navigating Officer', 'TNO', 'Nautical Cadet']],
  ],
  deck_ratings: [
    ['bosun', 'Bosun', 'deck_rating', 1, ['Boatswain', 'Bosun', "Bos'n"]],
    ['pumpman', 'Pumpman', 'deck_rating', 2, ['Pump Man']],
    ['able_seaman', 'Able Seaman (AB)', 'deck_rating', 3, ['Able Seaman', 'AB', 'A/B', 'Able Seafarer Deck', 'Able Bodied Seaman']],
    ['ordinary_seaman', 'Ordinary Seaman (OS)', 'deck_rating', 4, ['Ordinary Seaman', 'OS', 'O/S']],
    ['deck_trainee', 'Deck Trainee', 'deck_rating', 5, ['Trainee Seaman', 'Deck Boy', 'TOS', 'Trainee OS']],
  ],
  engine_officers: [
    ['chief_engineer', 'Chief Engineer', 'engine_officer', 1, ['C/E', 'CE', 'Chief Engg', 'Chief Eng', 'Chief Engineer Officer']],
    ['second_engineer', 'Second Engineer (2nd Engineer)', 'engine_officer', 2, ['Second Engineer', '2nd Engineer', '2/E', '2nd Engg', '2nd Eng', 'First Engineer', '1st Engineer']],
    ['third_engineer', 'Third Engineer (3rd Engineer)', 'engine_officer', 3, ['Third Engineer', '3rd Engineer', '3/E', '3rd Engg', '3rd Eng']],
    ['fourth_engineer', 'Fourth Engineer (4th Engineer)', 'engine_officer', 4, ['Fourth Engineer', '4th Engineer', '4/E', '4th Engg', '4th Eng']],
    ['junior_engineer', 'Junior Engineer / Fifth Engineer', 'engine_officer', 5, ['Junior Engineer', 'Fifth Engineer', '5th Engineer', '5/E', 'JE']],
    ['engine_cadet', 'Engine Cadet / Trainee Engineer', 'engine_officer', 6, ['Engine Cadet', 'Trainee Engineer', 'Trainee Marine Engineer', 'TME']],
    ['eto', 'Electro-Technical Officer (ETO)', 'electrical_officer', 1, ['Electro-Technical Officer', 'Electro Technical Officer', 'ETO', 'Electrical Engineer']],
    ['electrical_officer', 'Electrical Officer', 'electrical_officer', 2, ['Electrical Officer', 'Electro Officer', 'Elec Officer']],
    ['gas_engineer', 'Gas Engineer (LNG / LPG)', 'gas_engineer', 1, ['Gas Engineer', 'LNG Engineer', 'LPG Engineer', 'Cargo Engineer']],
  ],
  engine_ratings: [
    ['fitter', 'Fitter', 'engine_rating', 1, ['Engine Fitter']],
    ['motorman', 'Motorman', 'engine_rating', 2, ['Motor Man']],
    ['oiler', 'Oiler', 'engine_rating', 3, ['Greaser']],
    ['wiper', 'Wiper', 'engine_rating', 4, []],
    ['engine_trainee', 'Engine Trainee', 'engine_rating', 5, ['Trainee Wiper', 'Engine Boy']],
    ['electrician', 'Electrician / Electro-Technical Rating', 'electrical_rating', 1, ['Electrician', 'Electro-Technical Rating', 'Electro Technical Rating', 'ETR']],
  ],
  catering: [
    ['chief_cook', 'Chief Cook', 'galley', 1, ['Ch Cook', 'Head Cook']],
    ['cook', 'Cook', 'galley', 2, ['Ship Cook']],
    ['second_cook', 'Second Cook', 'galley', 3, ['2nd Cook', 'Assistant Cook']],
    ['messman', 'Messman', 'galley', 4, ['Mess Man', 'Mess Boy', 'General Steward', 'GS']],
    ['chief_steward', 'Chief Steward', 'hotel', 1, ['Ch Steward', 'Head Steward']],
    ['steward', 'Steward', 'hotel', 2, ['Stewardess']],
    ['hotel_purser', 'Hotel / Purser staff', 'purser', 1, ['Purser', 'Hotel Manager', 'Hotel Staff', 'Purser Staff']],
  ],
  specialist_offshore: [
    ['dp_operator', 'DP Operator (DPO / SDPO)', 'dp', 1, ['DP Operator', 'DPO', 'SDPO', 'Dynamic Positioning Operator', 'Senior Dynamic Positioning Operator', 'Senior DPO']],
    ['crane_operator', 'Crane Operator', 'crane', 1, ['Offshore Crane Operator', 'Crane Op']],
    ['rov_pilot', 'ROV Pilot / Technician', 'rov', 1, ['ROV Pilot', 'ROV Technician', 'ROV Pilot Technician']],
    ['barge_master', 'Barge Master', 'barge', 1, ['Bargemaster']],
    ['oim', 'Offshore Installation Manager (OIM)', 'oim', 1, ['Offshore Installation Manager', 'OIM']],
    ['tug_master', 'Tug Master', 'tug', 1, ['Tugmaster', 'Tug Captain']],
    ['yacht_crew', 'Yacht Captain / Crew', 'yacht', 1, ['Yacht Captain', 'Yacht Crew', 'Superyacht Crew']],
    ['inland_master', 'Inland / River Master', 'inland', 1, ['Inland Master', 'River Master', 'Inland Vessel Master']],
    ['marine_pilot', 'Marine Pilot', 'pilot', 1, ['Marine Pilot', 'Harbour Pilot', 'Sea Pilot', 'Pilot']],
  ],
  technical_fleet: [
    ['technical_superintendent', 'Technical Superintendent', 'fleet', 3, ['Tech Superintendent', 'Technical Super', 'Superintendent Engineer']],
    ['marine_superintendent', 'Marine Superintendent', 'marine_superintendent', 1, ['Marine Super', 'Offshore Marine Superintendent']],
    ['fleet_manager', 'Fleet Manager', 'fleet', 1, ['Fleet Director']],
    ['technical_manager', 'Technical Manager', 'fleet', 2, ['Technical Director', 'Vessel Manager']],
    ['electrical_superintendent', 'Electrical Superintendent', 'electrical_superintendent', 1, ['Electrical Super']],
    ['site_superintendent', 'New-building / Site Superintendent', 'site_superintendent', 1, ['Newbuilding Superintendent', 'New Building Superintendent', 'Site Superintendent', 'Dry Dock Superintendent']],
  ],
  hseq_vetting: [
    ['hseq_manager', 'HSEQ Manager', 'hseq', 1, ['QHSE Manager', 'HSSEQ Manager', 'HSE Manager', 'HSSEQ Superintendent', 'Offshore HSE Manager']],
    ['dpa', 'Designated Person Ashore (DPA)', 'dpa', 1, ['Designated Person Ashore', 'DPA']],
    ['cso', 'Company Security Officer (CSO)', 'cso', 1, ['Company Security Officer', 'CSO']],
    ['vetting_manager', 'Vetting Manager / Inspector', 'vetting', 1, ['Vetting Manager', 'Vetting Inspector', 'Vetting Superintendent', 'Marine Assurance Manager']],
    ['sire_inspector', 'SIRE / CDI Inspector', 'vetting', 2, ['SIRE Inspector', 'CDI Inspector', 'OCIMF Inspector']],
    ['safety_officer', 'Safety Officer', 'hseq', 2, ['HSE Officer', 'Safety Superintendent']],
  ],
  operations_commercial: [
    ['operations_manager', 'Operations Manager', 'operations', 1, ['Marine Operations Manager', 'Ops Manager']],
    ['ship_operator', 'Ship Operator', 'operations', 2, ['Voyage Operator', 'Vessel Operator', 'Cargo Operator']],
    ['chartering_manager', 'Chartering Manager / Broker', 'commercial', 2, ['Chartering Manager', 'Shipbroker', 'Ship Broker', 'Charterer', 'Chartering Broker']],
    ['commercial_manager', 'Commercial Manager', 'commercial', 1, ['Commercial Director']],
    ['post_fixture', 'Post-fixture / Claims Executive', 'post_fixture', 1, ['Post Fixture Executive', 'Post-Fixture Executive', 'Claims Executive', 'Demurrage Analyst']],
    ['bunker_trader', 'Bunker Trader', 'bunker', 1, ['Bunker Buyer', 'Bunker Broker']],
  ],
  crewing_manning: [
    ['crewing_manager', 'Crewing Manager', 'crewing', 1, ['Crew Manager', 'Crew Superintendent', 'Fleet Personnel Manager']],
    ['crew_coordinator', 'Crew Coordinator', 'crewing', 2, ['Crewing Executive', 'Crewing Officer']],
    ['manning_agent', 'Manning Agent', 'manning', 1, ['Manning Agency', 'Manning Officer']],
    ['travel_logistics', 'Travel / Logistics Coordinator', 'crew_travel', 1, ['Travel Coordinator', 'Crew Travel Coordinator']],
  ],
  port_terminal_logistics: [
    ['port_captain', 'Port Captain', 'port_captain', 1, ['Port Marine Superintendent']],
    ['harbour_master', 'Harbour Master', 'harbour_master', 1, ['Harbor Master', 'Deputy Harbour Master']],
    ['terminal_manager', 'Terminal Manager', 'terminal', 1, ['Marine Terminal Superintendent', 'Port Operations Manager']],
    ['port_marine_pilot', 'Marine Pilot', 'pilot', 1, [], 'marine_pilot'],
    ['freight_forwarder', 'Freight Forwarder', 'freight', 1, ['Freight Forwarding Executive', 'NVOCC Professional']],
    ['shipping_agent', 'Customs / Shipping Agent', 'agency', 1, ['Shipping Agent', 'Ship Agent', 'Port Agent', 'Customs Agent', 'Customs Broker']],
    ['logistics_executive', 'Logistics Executive', 'logistics', 2, ['Logistics Manager', 'Logistics Coordinator']],
  ],
  survey_class_legal_insurance: [
    ['marine_surveyor', 'Marine Surveyor', 'marine_surveyor', 1, ['Cargo Surveyor', 'Hull Surveyor', 'Condition Surveyor', 'Marine Warranty Surveyor']],
    ['class_surveyor', 'Class Surveyor', 'class_surveyor', 1, ['Classification Surveyor', 'Flag State Surveyor']],
    ['marine_consultant', 'Marine Consultant', 'consultant', 1, ['Maritime Consultant']],
    ['marine_lawyer', 'Marine Lawyer', 'lawyer', 1, ['Maritime Lawyer', 'Admiralty Lawyer', 'Shipping Lawyer']],
    ['pi_insurance', 'P&I / Insurance Executive', 'insurance', 1, ['P&I Executive', 'P&I Claims Executive', 'P&I Claims Manager', 'Insurance Executive', 'Marine Underwriter', 'Marine Insurance Broker']],
    ['average_adjuster', 'Average Adjuster', 'adjuster', 1, []],
  ],
  shipyard_engineering: [
    ['naval_architect', 'Naval Architect', 'naval_architect', 1, []],
    ['shipyard_project_manager', 'Shipyard Project Manager', 'shipyard', 1, ['Shipyard Manager', 'Yard Project Manager']],
    ['marine_engineer_shore', 'Marine Engineer (Shore)', 'shore_engineer', 1, ['Shore Marine Engineer', 'Port Engineer']],
    ['repair_manager', 'Repair Manager', 'shipyard', 2, ['Ship Repair Manager']],
  ],
  management: [
    ['director_ceo', 'Director / CEO', 'management', 1, ['Director', 'CEO', 'Managing Director', 'MD']],
    ['general_manager', 'General Manager', 'management', 2, ['GM']],
    ['department_head', 'Department Head', 'management', 3, ['Head of Department', 'HOD']],
  ],
  recruitment_hr: [
    ['hr_crewing_manager', 'Crewing Manager', 'crewing', 1, [], 'crewing_manager'],
    ['recruitment_manager', 'Recruitment Manager', 'recruitment', 1, ['Talent Acquisition Manager']],
    ['recruiter', 'Recruiter / Talent Acquisition', 'recruitment', 2, ['Recruiter', 'Talent Acquisition', 'Maritime Recruiter', 'Crewing Recruiter']],
    ['hr_manager', 'HR Manager', 'hr', 1, ['Human Resources Manager']],
    ['hr_executive', 'HR Executive', 'hr', 2, ['Maritime HR Professional', 'HR Officer']],
    ['manning_agency_owner', 'Manning Agent / Agency Owner', 'manning', 1, ['Agency Owner'], 'manning_agent'],
    ['hr_crew_coordinator', 'Crew Coordinator', 'crewing', 2, [], 'crew_coordinator'],
    ['payroll_compliance', 'Payroll / Compliance Officer', 'payroll', 1, ['Payroll Officer', 'Compliance Officer']],
  ],
  training: [
    ['institute_head', 'Maritime Training Institute Head / Principal', 'faculty', 1, ['Principal', 'Institute Head']],
    ['senior_faculty', 'Senior Faculty / Lecturer', 'faculty', 2, ['Senior Faculty', 'Lecturer', 'Maritime Academy Faculty', 'Nautical Instructor', 'Engineering Instructor']],
    ['simulator_instructor', 'Simulator Instructor (Bridge / Engine / DP)', 'simulator', 1, ['Simulator Instructor']],
    ['stcw_instructor', 'STCW Course Instructor (BST, AFF, Medical)', 'stcw', 1, ['STCW Instructor', 'Maritime Trainer']],
    ['assessor_examiner', 'Assessor / Examiner', 'assessor', 1, ['STCW Assessor', 'Examiner', 'Assessor']],
    ['online_course_creator', 'Online Course Creator / Coach', 'online', 1, ['Course Creator', 'Coach']],
    ['mentor', 'Mentor (Ex-Seafarer)', 'mentor', 1, ['Mentor']],
    ['wellbeing_trainer', 'Soft-skills / Wellbeing Trainer', 'wellbeing', 1, ['Soft Skills Trainer', 'Wellbeing Trainer']],
  ],
}

export const OTHER_ROLE_LABEL = 'Other (type your own)'
export const OTHER_ROLE_PREFIX = 'other_'

function departmentsOf(source: readonly { key: string; label: string }[], domain: RoleDomain): RoleDepartment[] {
  return source.map((entry) => ({ key: entry.key, label: entry.label, domain }))
}

export const ROLE_DEPARTMENTS: readonly RoleDepartment[] = [
  ...departmentsOf(SEA_DEPARTMENTS, 'sea'),
  ...departmentsOf(SHORE_DEPARTMENTS, 'shore'),
  ...departmentsOf(RECRUITER_DEPARTMENTS, 'shore'),
  ...departmentsOf(TRAINER_DEPARTMENTS, 'shore'),
]

export const ROLES: readonly RoleEntry[] = ROLE_DEPARTMENTS.flatMap((department) => [
  ...(ROLE_SEEDS[department.key] ?? []).map(([key, label, ladder, level, synonyms = [], sameAs]): RoleEntry => ({
    key,
    label,
    department: department.key,
    ladder,
    level,
    synonyms,
    ...(sameAs ? { sameAs } : {}),
  })),
  {
    key: `${OTHER_ROLE_PREFIX}${department.key}`,
    label: OTHER_ROLE_LABEL,
    department: department.key,
    ladder: `${OTHER_ROLE_PREFIX}${department.key}`,
    level: 99,
    synonyms: [],
    other: true,
  },
])

const departmentByKeyMap = new Map(ROLE_DEPARTMENTS.map((department) => [department.key, department]))
const roleByKeyMap = new Map(ROLES.map((role) => [role.key, role]))

const SEA_DEPARTMENT_KEYS = SEA_DEPARTMENTS.map((entry) => entry.key) as string[]
const SHORE_DEPARTMENT_KEYS = SHORE_DEPARTMENTS.map((entry) => entry.key) as string[]

/** Personas that pick a rank / role. Everyone else gives an optional occupation text instead. */
export const RANKED_PERSONAS = ['seafarer', 'shore_professional', 'recruiter_hr', 'trainer_instructor', 'student_cadet'] as const satisfies readonly Persona[]
/** Personas whose maritime-job matching is allowed for sea-going jobs. */
export const SEA_JOB_PERSONAS = ['seafarer', 'student_cadet'] as const satisfies readonly Persona[]

export function personaPicksRole(persona: Persona | null | undefined): boolean {
  return Boolean(persona && (RANKED_PERSONAS as readonly string[]).includes(persona))
}

export function personaMatchesSeaJobs(persona: Persona | null | undefined): boolean {
  return Boolean(persona && (SEA_JOB_PERSONAS as readonly string[]).includes(persona))
}

/**
 * The departments a persona picks from. Student / Cadet picks a target job role from the seafarer
 * lists and the shore lists (for cadets planning to work ashore).
 */
export function departmentsFor(persona: Persona | null | undefined): RoleDepartment[] {
  switch (persona) {
    case 'seafarer':
      return ROLE_DEPARTMENTS.filter((department) => SEA_DEPARTMENT_KEYS.includes(department.key))
    case 'shore_professional':
      return ROLE_DEPARTMENTS.filter((department) => SHORE_DEPARTMENT_KEYS.includes(department.key))
    case 'recruiter_hr':
      return ROLE_DEPARTMENTS.filter((department) => department.key === 'recruitment_hr')
    case 'trainer_instructor':
      return ROLE_DEPARTMENTS.filter((department) => department.key === 'training')
    case 'student_cadet':
      return ROLE_DEPARTMENTS.filter((department) =>
        SEA_DEPARTMENT_KEYS.includes(department.key) || SHORE_DEPARTMENT_KEYS.includes(department.key))
    default:
      return []
  }
}

/** Every department a job can be posted in (seafarer, shore, recruitment and training lists). */
export function jobDepartments(): RoleDepartment[] {
  return [...ROLE_DEPARTMENTS]
}

export function departmentByKey(key: string | null | undefined): RoleDepartment | undefined {
  return key ? departmentByKeyMap.get(key) : undefined
}

export function rolesFor(departmentKey: string | null | undefined): RoleEntry[] {
  if (!departmentKey) return []
  return ROLES.filter((role) => role.department === departmentKey)
}

export function roleByKey(key: string | null | undefined): RoleEntry | undefined {
  return key ? roleByKeyMap.get(key) : undefined
}

export function isOtherRoleKey(key: string | null | undefined): boolean {
  return Boolean(roleByKey(key)?.other)
}

export function otherRoleKeyFor(departmentKey: string) {
  return `${OTHER_ROLE_PREFIX}${departmentKey}`
}

export function isSeaDepartment(departmentKey: string | null | undefined): boolean {
  return departmentByKey(departmentKey)?.domain === 'sea'
}

export function domainForDepartment(departmentKey: string | null | undefined): RoleDomain | null {
  return departmentByKey(departmentKey)?.domain ?? null
}

/** The role used for comparisons: entries that are the same job in another department collapse to one. */
function canonicalRole(role: RoleEntry): RoleEntry {
  return role.sameAs ? roleByKeyMap.get(role.sameAs) ?? role : role
}

export function sameDepartment(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = roleByKey(a)
  const right = roleByKey(b)
  if (!left || !right) return false
  return canonicalRole(left).department === canonicalRole(right).department
}

/**
 * How far the candidate's role sits below the target role on the same ladder: 0 = same rank,
 * 1 = one level more junior, -1 = one level more senior. null when the two cannot be compared
 * (different department or ladder, an unknown key, or an "Other" rank).
 */
export function ladderDistance(candidateKey: string | null | undefined, targetKey: string | null | undefined): number | null {
  const candidate = roleByKey(candidateKey)
  const target = roleByKey(targetKey)
  if (!candidate || !target || candidate.other || target.other) return null
  const left = canonicalRole(candidate)
  const right = canonicalRole(target)
  if (left.key === right.key) return 0
  if (left.department !== right.department || left.ladder !== right.ladder) return null
  return left.level - right.level
}

/** Case, space and punctuation-insensitive form used to compare free text with labels and synonyms. */
export function normaliseRoleText(text: string): string {
  return text
    .toLocaleLowerCase('en')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const legacyLookup = (() => {
  const lookup = new Map<string, string>()
  const add = (text: string, key: string) => {
    const normalised = normaliseRoleText(text)
    if (normalised && !lookup.has(normalised)) lookup.set(normalised, key)
  }
  // Labels first, so an exact label always wins over another entry's synonym.
  for (const role of ROLES) {
    if (role.other || role.sameAs) continue
    add(role.label, role.key)
    add(role.label.replace(/\s*\([^)]*\)\s*/g, ' '), role.key)
  }
  for (const role of ROLES) {
    if (role.other || role.sameAs) continue
    for (const synonym of role.synonyms) add(synonym, role.key)
  }
  return lookup
})()

/** Converts an old free-text rank ("Captain", "C/O", "2nd Engineer") to a key, or null when it is not recognised. */
export function normaliseLegacyRank(text: string | null | undefined): string | null {
  if (!text) return null
  const normalised = normaliseRoleText(text)
  if (!normalised) return null
  return legacyLookup.get(normalised) ?? null
}

/** What a profile or job shows for a role: the taxonomy label, the typed "Other" text, else the old text. */
export function roleDisplayLabel(input: {
  roleKey?: string | null
  otherText?: string | null
  legacyText?: string | null
}): string | null {
  const role = roleByKey(input.roleKey)
  if (role?.other) return input.otherText?.trim() || input.legacyText?.trim() || null
  if (role) return role.label
  return input.legacyText?.trim() || null
}

/** Label for a set of accepted roles on a job, for example "Master / Captain, Chief Officer". */
export function acceptedRolesLabel(keys: readonly string[], otherText?: string | null): string | null {
  const labels = keys.flatMap((key) => {
    const role = roleByKey(key)
    if (!role) return []
    if (role.other) return otherText?.trim() ? [otherText.trim()] : []
    return [role.label]
  })
  return labels.length ? labels.join(', ') : null
}

/** What a job shows for its rank: the accepted rank labels when it has keys, else its old rank text. */
export function jobRankDisplay(job: { acceptedRoleKeys?: readonly string[] | null; roleOtherText?: string | null; rank?: string | null }): string | null {
  return acceptedRolesLabel(job.acceptedRoleKeys ?? [], job.roleOtherText) ?? job.rank?.trim() ?? null
}

/** What a job shows for its department: the taxonomy label when it has a key, else its old text. */
export function jobDepartmentDisplay(job: { departmentKey?: string | null; department?: string | null }): string | null {
  return departmentByKey(job.departmentKey)?.label ?? job.department?.trim() ?? null
}

/* ---------- Student / Cadet ---------- */

export const CADET_STAGES = [
  { key: 'pre_sea', label: 'Pre-sea Student' },
  { key: 'deck_cadet', label: 'Deck Cadet (on board)' },
  { key: 'engine_cadet', label: 'Engine Cadet (on board)' },
  { key: 'eto_cadet', label: 'ETO Cadet' },
  { key: 'trainee_rating', label: 'Trainee Rating' },
  { key: 'coc_exam', label: 'Preparing for CoC exam (2nd Mate / MEO Class IV, etc.)' },
] as const

export const CADET_COURSES = [
  { key: 'bsc_nautical_science', label: 'B.Sc Nautical Science' },
  { key: 'dns', label: 'DNS' },
  { key: 'btech_marine_engineering', label: 'B.Tech Marine Engineering' },
  { key: 'gme', label: 'GME' },
  { key: 'eto_course', label: 'ETO course' },
  { key: 'gp_rating', label: 'GP Rating' },
  { key: 'ccmc', label: 'CCMC / Catering course' },
] as const

export type CadetStageKey = (typeof CADET_STAGES)[number]['key']
export type CadetCourseKey = (typeof CADET_COURSES)[number]['key']

export const CADET_STAGE_KEYS = CADET_STAGES.map((stage) => stage.key) as CadetStageKey[]
export const CADET_COURSE_KEYS = CADET_COURSES.map((course) => course.key) as CadetCourseKey[]

export function cadetStageLabel(key: string | null | undefined) {
  return CADET_STAGES.find((stage) => stage.key === key)?.label ?? null
}

export function cadetCourseLabel(key: string | null | undefined) {
  return CADET_COURSES.find((course) => course.key === key)?.label ?? null
}

/** A sensible target job role for a cadet's stage (and pre-sea course), which they can change. */
export function defaultTargetRoleFor(stage: string | null | undefined, course?: string | null): string | null {
  switch (stage) {
    case 'deck_cadet':
      return 'third_officer'
    case 'engine_cadet':
      return 'fourth_engineer'
    case 'eto_cadet':
      return 'eto'
    case 'trainee_rating':
      return 'ordinary_seaman'
    case 'pre_sea':
      switch (course) {
        case 'bsc_nautical_science':
        case 'dns':
          return 'deck_cadet'
        case 'btech_marine_engineering':
        case 'gme':
          return 'engine_cadet'
        case 'eto_course':
          return 'eto'
        case 'gp_rating':
          return 'ordinary_seaman'
        case 'ccmc':
          return 'messman'
        default:
          return null
      }
    default:
      return null
  }
}

/** The rank a cadet already holds on board, compared alongside the target role (a cadet job still matches cadets). */
export function cadetStageRoleKey(stage: string | null | undefined): string | null {
  if (stage === 'deck_cadet') return 'deck_cadet'
  if (stage === 'engine_cadet') return 'engine_cadet'
  return null
}

/* ---------- Legacy conversion ---------- */

/** Every normalised text normaliseLegacyRank recognises, with its key (migration 0062 backfills from the same list). */
export function legacyRankEntries(): Array<[text: string, key: string]> {
  return [...legacyLookup.entries()]
}

/** The persona whose rank lists an older profile edits as (same mapping as personaForProfile). */
export function rankPersonaFor(persona: Persona | null | undefined, profileType?: string | null): Persona {
  if (persona) return persona
  if (profileType === 'seafarer') return 'seafarer'
  if (profileType === 'recruiter') return 'recruiter_hr'
  if (profileType === 'trainer') return 'trainer_instructor'
  return 'shore_professional'
}

/**
 * normaliseLegacyRank, limited to the departments the persona picks from. A recognised rank in
 * another persona's list resolves to the same job in this persona's list when there is one (a
 * recruiter's "Crewing Manager"), otherwise null.
 */
export function normaliseLegacyRankForPersona(text: string | null | undefined, persona: Persona | null | undefined): string | null {
  const key = normaliseLegacyRank(text)
  if (!key) return null
  const allowed = new Set(departmentsFor(persona).map((department) => department.key))
  const role = roleByKey(key)
  if (role && allowed.has(role.department)) return key
  return ROLES.find((entry) => entry.sameAs === key && allowed.has(entry.department))?.key ?? null
}
