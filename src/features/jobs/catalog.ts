export const JOB_DISCOVERY_MODES = [
  { value: 'for-you', label: 'For You' },
  { value: 'sea', label: 'Sea Jobs' },
  { value: 'shore', label: 'Shore Jobs' },
  { value: 'urgent', label: 'Urgent Joining' },
  { value: 'recent', label: 'Recently Posted' },
] as const

export type JobDiscoveryMode = (typeof JOB_DISCOVERY_MODES)[number]['value']

export const SEA_RANKS = [
  'Master',
  'Chief Officer',
  'Second Officer',
  'Third Officer',
  'Deck Cadet',
  'Chief Engineer',
  'Second Engineer',
  'Third Engineer',
  'Fourth Engineer',
  'Engine Cadet',
  'ETO',
  'Electrical Officer',
  'Bosun',
  'Able Seaman',
  'Ordinary Seaman',
  'Fitter',
  'Oiler',
  'Wiper',
  'Pumpman',
  'Chief Cook',
  'Steward',
] as const

export const SHORE_ROLES = [
  'Technical Superintendent',
  'Marine Superintendent',
  'Fleet Manager',
  'Port Captain',
  'Vetting Superintendent',
  'QHSE Superintendent',
  'Crewing Manager',
  'Marine Surveyor',
  'Marine Consultant',
  'Chartering Manager',
  'Operations Manager',
  'Marine Insurance',
  'Maritime Lawyer',
  'Maritime Trainer',
  'Marine Procurement',
  'Maritime Technology',
] as const

export const VESSEL_TYPES = [
  'Oil Tanker',
  'Chemical Tanker',
  'LNG',
  'LPG',
  'Bulk Carrier',
  'Container',
  'General Cargo',
  'Ro-Ro',
  'Car Carrier',
  'Passenger',
  'Cruise',
  'AHTS',
  'PSV',
  'Offshore Support',
  'Dredger',
] as const

export const JOB_DEPARTMENTS = ['Deck', 'Engine', 'Electrical', 'Catering', 'Offshore', 'Shore'] as const

export const MARITIME_CERTIFICATES = [
  'STCW',
  'Certificate of Competency',
  'GMDSS',
  'Advanced Oil Tanker',
  'Advanced Chemical Tanker',
  'Advanced Gas Tanker',
  'Medical Certificate',
  'Ship Security Officer',
  'Dynamic Positioning',
] as const

export const MARITIME_VISAS = ['US C1/D', 'Schengen', 'UK Transit', 'Australian MCV'] as const
