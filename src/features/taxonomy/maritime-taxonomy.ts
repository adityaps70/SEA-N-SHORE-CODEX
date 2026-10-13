import { ROLES, normaliseLegacyRank, normaliseRoleText, roleByKey, ladderDistance, type RoleEntry } from '@/features/roles/taxonomy'

/**
 * Round G (G0.1): the canonical maritime taxonomy. Ranks are the round-12 role list
 * (features/roles/taxonomy.ts); this file adds vessel types and certificate types and the helpers
 * every scorer shares. The migration seeds public.maritime_ranks, public.vessel_types and
 * public.certificate_types from these lists word for word (maritime-taxonomy-seed.test.ts checks it).
 *
 * Codes are stable snake_case: never shown, never renamed after release. A new entry is a code
 * change plus a seed row in a later migration.
 */

export const RANK_DEPARTMENT_GROUPS = ['deck', 'engine', 'electrical', 'catering', 'shore'] as const
export type RankDepartmentGroup = (typeof RANK_DEPARTMENT_GROUPS)[number]

const DEPARTMENT_GROUP_BY_KEY: Record<string, RankDepartmentGroup> = {
  deck_officers: 'deck',
  deck_ratings: 'deck',
  engine_officers: 'engine',
  engine_ratings: 'engine',
  catering: 'catering',
  specialist_offshore: 'deck',
}
const ELECTRICAL_LADDERS = new Set(['electrical_officer', 'electrical_rating'])

/** deck / engine / electrical / catering / shore for a rank code, or null for an unknown code. */
export function rankDepartmentGroup(code: string | null | undefined): RankDepartmentGroup | null {
  const role = roleByKey(code)
  if (!role) return null
  if (ELECTRICAL_LADDERS.has(role.ladder)) return 'electrical'
  return DEPARTMENT_GROUP_BY_KEY[role.department] ?? 'shore'
}

/**
 * Ladder steps between two ranks inside one department ladder (0 = same rank), or null when they
 * cannot be compared (different department or ladder, unknown, or "Other"). Used by PYMK, jobs and
 * search. Unlike ladderDistance it has no direction.
 */
export function rankDistance(a: string | null | undefined, b: string | null | undefined): number | null {
  const distance = ladderDistance(a, b)
  return distance === null ? null : Math.abs(distance)
}

/** Ranks within this many ladder steps count as one "rank band" (for example 2/O with C/O and 3/O). */
export const RANK_BAND_STEPS = 1

export type RankSeed = {
  code: string
  name: string
  departmentKey: string
  department: RankDepartmentGroup
  ladder: string
  ladderLevel: number
  synonyms: readonly string[]
  sameAs: string | null
}

/**
 * Synonyms the G0 taxonomy adds to the round-12 role list. They are kept out of normaliseLegacyRank,
 * whose recognised texts migration 0062's backfill pins (structured-roles-schema-contract.test.ts).
 */
const EXTRA_RANK_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  marine_superintendent: ['Marine Manager'],
}

/** Every rank the taxonomy table holds: the role list without "Other" entries. */
export const MARITIME_RANKS: readonly RankSeed[] = ROLES
  .filter((role: RoleEntry) => !role.other)
  .map((role) => ({
    code: role.key,
    name: role.label,
    departmentKey: role.department,
    department: rankDepartmentGroup(role.key) ?? 'shore',
    ladder: role.ladder,
    ladderLevel: role.level,
    synonyms: [...role.synonyms, ...(EXTRA_RANK_SYNONYMS[role.key] ?? [])],
    sameAs: role.sameAs ?? null,
  }))

const extraRankLookup = new Map(Object.entries(EXTRA_RANK_SYNONYMS).flatMap(([code, synonyms]) => synonyms.map((synonym) => [normaliseRoleText(synonym), code] as const)))

/** A rank code for free text: the round-12 lookup, then the G0 extra synonyms (same as taxonomy_code('rank', …) in SQL). */
export function matchRank(text: string | null | undefined): string | null {
  if (!text) return null
  return normaliseLegacyRank(text) ?? extraRankLookup.get(normaliseRoleText(text)) ?? null
}

export const VESSEL_GROUPS = ['tanker', 'gas', 'dry_bulk', 'container', 'offshore', 'passenger', 'other'] as const
export type VesselGroup = (typeof VESSEL_GROUPS)[number]

export const VESSEL_GROUP_LABELS: Record<VesselGroup, string> = {
  tanker: 'Tankers',
  gas: 'Gas carriers',
  dry_bulk: 'Dry bulk and cargo',
  container: 'Container ships',
  offshore: 'Offshore',
  passenger: 'Passenger ships',
  other: 'Other vessels',
}

export type VesselTypeSeed = { code: string; name: string; group: VesselGroup; synonyms: readonly string[] }

export const VESSEL_TYPE_SEEDS: readonly VesselTypeSeed[] = [
  { code: 'oil_tanker', name: 'Oil Tanker', group: 'tanker', synonyms: ['Tanker', 'Oil Tankers', 'Tankers'] },
  { code: 'crude_tanker', name: 'Crude Oil Tanker', group: 'tanker', synonyms: ['Crude', 'Crude Tanker', 'Crude Carrier', 'VLCC', 'ULCC', 'Suezmax', 'Aframax'] },
  { code: 'product_tanker', name: 'Product Tanker', group: 'tanker', synonyms: ['Product', 'Products Tanker', 'Clean Product Tanker', 'Oil Product Tanker', 'MR Tanker', 'LR1', 'LR2'] },
  { code: 'chemical_tanker', name: 'Chemical Tanker', group: 'tanker', synonyms: ['Chemical', 'Chem Tanker', 'Oil Chemical Tanker', 'Oil/Chemical Tanker', 'Chemical Carrier'] },
  { code: 'lpg_carrier', name: 'LPG Carrier', group: 'gas', synonyms: ['LPG', 'LPG Tanker', 'VLGC', 'Gas Carrier'] },
  { code: 'lng_carrier', name: 'LNG Carrier', group: 'gas', synonyms: ['LNG', 'LNG Tanker', 'LNGC'] },
  { code: 'bulk_carrier', name: 'Bulk Carrier', group: 'dry_bulk', synonyms: ['Bulk', 'Bulker', 'Dry Bulk', 'Capesize', 'Panamax', 'Supramax', 'Ultramax', 'Handysize', 'Handymax'] },
  { code: 'general_cargo', name: 'General Cargo', group: 'dry_bulk', synonyms: ['General Cargo Ship', 'Multipurpose', 'Multi Purpose', 'MPP', 'Breakbulk', 'Break Bulk'] },
  { code: 'container', name: 'Container Ship', group: 'container', synonyms: ['Container', 'Containership', 'Container Vessel', 'Box Ship', 'Feeder'] },
  { code: 'ro_ro', name: 'Ro-Ro', group: 'other', synonyms: ['RoRo', 'Ro Ro', 'Roll on Roll off'] },
  { code: 'car_carrier', name: 'Car Carrier', group: 'other', synonyms: ['PCC', 'PCTC', 'Vehicle Carrier', 'Car Carrier Ship'] },
  { code: 'osv', name: 'Offshore Support Vessel', group: 'offshore', synonyms: ['Offshore Support', 'OSV', 'Offshore Supply Vessel', 'Offshore'] },
  { code: 'ahts', name: 'AHTS', group: 'offshore', synonyms: ['Anchor Handling Tug Supply', 'Anchor Handler', 'AHT'] },
  { code: 'psv', name: 'PSV', group: 'offshore', synonyms: ['Platform Supply Vessel', 'Platform Supply'] },
  { code: 'dp_vessel', name: 'DP Vessel', group: 'offshore', synonyms: ['DP Vessels', 'Dynamic Positioning Vessel', 'DSV', 'Drillship', 'Drill Ship', 'MODU'] },
  { code: 'tug', name: 'Tug', group: 'offshore', synonyms: ['Tugboat', 'Tug Boat', 'Harbour Tug'] },
  { code: 'dredger', name: 'Dredger', group: 'other', synonyms: ['TSHD', 'CSD', 'Dredging Vessel'] },
  { code: 'cruise', name: 'Cruise Ship', group: 'passenger', synonyms: ['Cruise', 'Cruise Liner', 'Cruise Vessel'] },
  { code: 'ferry', name: 'Ferry', group: 'passenger', synonyms: ['Ropax', 'Ro Pax', 'Passenger Ferry'] },
  { code: 'passenger', name: 'Passenger Ship', group: 'passenger', synonyms: ['Passenger', 'Passenger Vessel'] },
  { code: 'reefer', name: 'Reefer', group: 'other', synonyms: ['Refrigerated Cargo', 'Reefer Ship'] },
  { code: 'yacht', name: 'Yacht', group: 'passenger', synonyms: ['Superyacht', 'Super Yacht', 'Motor Yacht'] },
]

export const CERTIFICATE_CATEGORIES = ['stcw_basic', 'stcw_advanced', 'tanker', 'gas', 'dp', 'navigation', 'security', 'medical', 'coc'] as const
export type CertificateCategory = (typeof CERTIFICATE_CATEGORIES)[number]

export type CertificateTypeSeed = {
  code: string
  name: string
  category: CertificateCategory
  synonyms: readonly string[]
  /** A Certificate of Competency: its grade is the rank it allows (a rank code), when it names one. */
  cocRankCode?: string
}

export const CERTIFICATE_TYPE_SEEDS: readonly CertificateTypeSeed[] = [
  { code: 'stcw_basic', name: 'STCW Basic Safety (all modules)', category: 'stcw_basic', synonyms: ['STCW', 'STCW Basic', 'STCW 95', 'STCW 2010', 'STCW Basic Safety', 'Basic STCW'] },
  { code: 'bst', name: 'Basic Safety Training (BST)', category: 'stcw_basic', synonyms: ['Basic Safety Training', 'BST'] },
  { code: 'pst', name: 'Personal Survival Techniques (PST)', category: 'stcw_basic', synonyms: ['Personal Survival Techniques', 'PST', 'PSCRB', 'Proficiency in Survival Craft', 'Survival Craft and Rescue Boats'] },
  { code: 'fpff', name: 'Fire Prevention and Fire Fighting (FPFF)', category: 'stcw_basic', synonyms: ['Fire Prevention and Fire Fighting', 'FPFF', 'Basic Fire Fighting'] },
  { code: 'efa', name: 'Elementary First Aid (EFA)', category: 'stcw_basic', synonyms: ['Elementary First Aid', 'EFA'] },
  { code: 'pssr', name: 'Personal Safety and Social Responsibilities (PSSR)', category: 'stcw_basic', synonyms: ['Personal Safety and Social Responsibilities', 'Personal Safety and Social Responsibility', 'PSSR'] },
  { code: 'aff', name: 'Advanced Fire Fighting (AFF)', category: 'stcw_advanced', synonyms: ['Advanced Fire Fighting', 'Advanced Firefighting', 'AFF'] },
  { code: 'mfa', name: 'Medical First Aid (MFA)', category: 'stcw_advanced', synonyms: ['Medical First Aid', 'MFA'] },
  { code: 'medical_care', name: 'Medical Care', category: 'stcw_advanced', synonyms: ['Medical Care', 'Medical Care on Board', 'MC', 'MECA'] },
  { code: 'gmdss', name: 'GMDSS', category: 'navigation', synonyms: ['GMDSS GOC', 'General Operator Certificate', 'GOC', 'GMDSS General Operator', 'ROC', 'Restricted Operator Certificate'] },
  { code: 'ecdis', name: 'ECDIS', category: 'navigation', synonyms: ['Generic ECDIS', 'ECDIS Generic', 'Type Specific ECDIS', 'ECDIS Type Specific'] },
  { code: 'brm', name: 'Bridge Resource Management (BRM)', category: 'navigation', synonyms: ['Bridge Resource Management', 'BRM', 'BTM', 'Bridge Team Management'] },
  { code: 'erm', name: 'Engine Room Resource Management (ERM)', category: 'navigation', synonyms: ['Engine Room Resource Management', 'ERM', 'ERRM'] },
  { code: 'tanker_familiarisation', name: 'Oil and Chemical Tanker Familiarisation', category: 'tanker', synonyms: ['Tanker Familiarisation', 'Tanker Familiarization', 'Oil and Chemical Tanker Familiarization', 'Basic Oil and Chemical Tanker', 'Basic Oil and Chemical Tanker Cargo Operations', 'OCTF', 'TF'] },
  { code: 'advanced_oil', name: 'Advanced Oil Tanker', category: 'tanker', synonyms: ['Advanced Oil Tanker', 'Advanced Oil Tanker Cargo Operations', 'AOT', 'Advanced Oil Tanker Training'] },
  { code: 'advanced_chemical', name: 'Advanced Chemical Tanker', category: 'tanker', synonyms: ['Advanced Chemical Tanker', 'Advanced Chemical Tanker Cargo Operations', 'ACT'] },
  { code: 'gas_familiarisation', name: 'Liquefied Gas Tanker Familiarisation', category: 'gas', synonyms: ['Gas Tanker Familiarisation', 'Gas Tanker Familiarization', 'Basic Liquefied Gas Tanker', 'Basic Liquefied Gas Tanker Cargo Operations', 'LGTF'] },
  { code: 'advanced_gas', name: 'Advanced Gas Tanker', category: 'gas', synonyms: ['Advanced Gas Tanker', 'Advanced Liquefied Gas Tanker', 'Advanced Liquefied Gas Tanker Cargo Operations', 'AGT'] },
  { code: 'dp_basic', name: 'DP Basic (Induction)', category: 'dp', synonyms: ['DP Basic', 'DP Induction', 'Dynamic Positioning Basic', 'Dynamic Positioning Induction', 'Dynamic Positioning', 'DP'] },
  { code: 'dp_advanced', name: 'DP Advanced (Simulator)', category: 'dp', synonyms: ['DP Advanced', 'DP Simulator', 'Dynamic Positioning Advanced', 'Dynamic Positioning Simulator'] },
  { code: 'dp_certificate', name: 'DP Operator Certificate', category: 'dp', synonyms: ['DPO Certificate', 'Unlimited DP Certificate', 'Limited DP Certificate', 'Nautical Institute DP Certificate'] },
  { code: 'sso', name: 'Ship Security Officer (SSO)', category: 'security', synonyms: ['Ship Security Officer', 'SSO'] },
  { code: 'sdsd', name: 'Designated Security Duties (SDSD)', category: 'security', synonyms: ['Security Training for Seafarers with Designated Security Duties', 'Designated Security Duties', 'SDSD', 'Security Awareness', 'PSA', 'Proficiency in Security Awareness'] },
  { code: 'medical_fitness', name: 'Seafarer Medical Certificate', category: 'medical', synonyms: ['Medical Certificate', 'Medical Fitness Certificate', 'Medical Fitness', 'Seafarer Medical', 'ENG1', 'DG Medical', 'PEME'] },
  { code: 'coc', name: 'Certificate of Competency (COC)', category: 'coc', synonyms: ['Certificate of Competency', 'COC', 'CoC', 'License', 'Licence'] },
  { code: 'coc_master', name: 'COC: Master', category: 'coc', cocRankCode: 'master', synonyms: ['Master COC', 'COC Master', 'Master Unlimited', 'Master FG', 'Master Foreign Going', 'Class 1 Deck', 'Masters Certificate'] },
  { code: 'coc_chief_mate', name: 'COC: Chief Mate', category: 'coc', cocRankCode: 'chief_officer', synonyms: ['Chief Mate COC', 'COC Chief Mate', 'Chief Mate FG', 'Chief Mate Foreign Going', 'Class 2 Deck', 'First Mate COC'] },
  { code: 'coc_oow_deck', name: 'COC: Officer in Charge of a Navigational Watch', category: 'coc', cocRankCode: 'third_officer', synonyms: ['OOW COC', 'OOW Deck', 'Second Mate COC', 'Second Mate FG', 'Second Mate Foreign Going', 'Class 3 Deck', 'Watchkeeping Officer Deck', 'NWKO'] },
  { code: 'coc_chief_engineer', name: 'COC: Chief Engineer', category: 'coc', cocRankCode: 'chief_engineer', synonyms: ['Chief Engineer COC', 'COC Chief Engineer', 'MEO Class 1', 'Class 1 Engine', 'Class 1 Motor'] },
  { code: 'coc_second_engineer', name: 'COC: Second Engineer', category: 'coc', cocRankCode: 'second_engineer', synonyms: ['Second Engineer COC', 'COC Second Engineer', 'MEO Class 2', 'Class 2 Engine', 'Class 2 Motor'] },
  { code: 'coc_oow_engine', name: 'COC: Officer in Charge of an Engineering Watch', category: 'coc', cocRankCode: 'fourth_engineer', synonyms: ['EOOW COC', 'OOW Engine', 'MEO Class 4', 'Class 4 Engine', 'Class 4 Motor', 'Watchkeeping Officer Engine'] },
  { code: 'coc_eto', name: 'COC: Electro-Technical Officer', category: 'coc', cocRankCode: 'eto', synonyms: ['ETO COC', 'COC ETO', 'Electro Technical Officer COC'] },
  { code: 'coc_rating_deck', name: 'COC: Able Seafarer Deck', category: 'coc', cocRankCode: 'able_seaman', synonyms: ['Able Seafarer Deck', 'AB Certificate', 'Watchkeeping Rating Deck', 'Rating Forming Part of a Navigational Watch', 'RFPNW'] },
  { code: 'coc_rating_engine', name: 'COC: Able Seafarer Engine', category: 'coc', cocRankCode: 'motorman', synonyms: ['Able Seafarer Engine', 'Watchkeeping Rating Engine', 'Rating Forming Part of an Engineering Watch', 'RFPEW'] },
]

type Matchable = { code: string; name: string; synonyms: readonly string[] }

/** One lookup per list: the name first (an exact name wins), then each synonym. Case, dot and space insensitive. */
function buildLookup(entries: readonly Matchable[]) {
  const lookup = new Map<string, string>()
  const add = (text: string, code: string) => {
    const key = normaliseRoleText(text)
    if (key && !lookup.has(key)) lookup.set(key, code)
  }
  for (const entry of entries) {
    add(entry.name, entry.code)
    add(entry.name.replace(/\s*\([^)]*\)\s*/g, ' '), entry.code)
  }
  for (const entry of entries) for (const synonym of entry.synonyms) add(synonym, entry.code)
  return lookup
}

const vesselLookup = buildLookup(VESSEL_TYPE_SEEDS)
const certificateLookup = buildLookup(CERTIFICATE_TYPE_SEEDS)
const vesselByCode = new Map(VESSEL_TYPE_SEEDS.map((entry) => [entry.code, entry]))
const certificateByCode = new Map(CERTIFICATE_TYPE_SEEDS.map((entry) => [entry.code, entry]))

/** The taxonomy's text key: the same as normaliseRoleText and public.taxonomy_normalize(). */
export const normaliseTaxonomyText = normaliseRoleText

export function matchVesselType(text: string | null | undefined): string | null {
  if (!text) return null
  return vesselLookup.get(normaliseRoleText(text)) ?? null
}

export function matchCertificateType(text: string | null | undefined): string | null {
  if (!text) return null
  return certificateLookup.get(normaliseRoleText(text)) ?? null
}

export function vesselTypeByCode(code: string | null | undefined) {
  return code ? vesselByCode.get(code) : undefined
}

export function certificateTypeByCode(code: string | null | undefined) {
  return code ? certificateByCode.get(code) : undefined
}

export function vesselGroupOf(code: string | null | undefined): VesselGroup | null {
  return vesselTypeByCode(code)?.group ?? null
}

/** Codes for a list of free-text vessel types (unknown values are left out). */
export function vesselTypeCodes(values: readonly string[]): string[] {
  return [...new Set(values.flatMap((value) => {
    const code = matchVesselType(value)
    return code ? [code] : []
  }))]
}

/** Vessel groups for a list of vessel-type codes. */
export function vesselGroupsOf(codes: readonly string[]): VesselGroup[] {
  return [...new Set(codes.flatMap((code) => {
    const group = vesselGroupOf(code)
    return group ? [group] : []
  }))]
}
