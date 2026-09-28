/**
 * Logos shown on the landing page. Files live in public/landing/logos; width/height are
 * the intrinsic sizes so the browser reserves the right box. `small` marks very wide
 * wordmarks that are drawn shorter so they do not dominate a row.
 */
export type LandingLogo = { file: string; name: string; width: number; height: number; small?: boolean }

const logo = (file: string, name: string, width: number, height: number, small?: boolean): LandingLogo => ({
  file: `/landing/logos/${file}`,
  name,
  width,
  height,
  small,
})

/** Maritime companies hiring on Sea N Shore, in the approved order. */
export const HIRING_COMPANIES: LandingLogo[] = [
  logo('c_wallem.svg', 'Wallem', 196, 40, true),
  logo('c_eletson.webp', 'Eletson', 275, 180),
  logo('c_mas.webp', 'MAS Ship Management', 300, 74),
  logo('c_ryan.svg', 'Ryan Ship Management', 1825, 638, true),
  logo('c_sinasta.webp', 'Sinasta Maritime', 228, 67),
  logo('c_nordships.webp', 'Nordships Maritime', 199, 180),
  logo('c_asm.webp', 'ASM Maritime', 182, 68),
  logo('c_allweather.webp', 'All Weather STS', 238, 180),
  logo('c_tangar.webp', 'Tangar', 240, 109),
  logo('c_suntech.webp', 'Suntech', 520, 66, true),
  logo('c_jataj.webp', 'Jataj Shipping Lines', 223, 90),
  logo('c_pg.webp', 'PG Maritime', 271, 61),
  logo('c_aza.webp', 'AZA Shipping', 154, 97),
  logo('c_midas.webp', 'Midas', 210, 180),
  logo('c_medallion.webp', 'Medallion', 188, 147),
  logo('c_nova.webp', 'Nova', 205, 92),
  logo('c_indaust.webp', 'Ind-Aust Group', 192, 62),
  logo('c_marivet.webp', 'MariVet', 192, 76),
  logo('c_krmarine.webp', 'K.R. Marine Services', 287, 117),
  logo('c_shanti.webp', 'M.S. Shanti Marine Services', 177, 180),
  logo('c_yogayatan.webp', 'Yogayatan Group', 241, 67),
  logo('c_ocean.webp', 'Ocean', 276, 180),
]

/** Extra hiring partners shown only in the partners grid (no public name yet). */
export const MORE_HIRING_PARTNERS: LandingLogo[] = [
  logo('c_we.webp', 'Hiring partner', 146, 180),
  logo('c_19.webp', 'Hiring partner', 169, 169),
]

export type PartnerLogo = LandingLogo & { role: string }

export const PARTNERS: PartnerLogo[] = [
  { ...logo('p_khyaal.webp', 'Khyaal', 180, 180), role: 'Senior citizens support' },
  { ...logo('p_bfs2.webp', 'Beaufort Financial Services', 200, 133), role: 'Finance education' },
  { ...logo('p_beaufort_it.webp', 'Beaufort IT Solutions', 200, 66), role: 'Technology' },
  { ...logo('p_mtcpl.webp', 'MTCPL — Voice of Sea', 126, 133), role: 'News' },
  { ...logo('p_starfish.webp', 'Starfish Travel Corporation', 292, 58), role: 'Visa' },
  { ...logo('p_oceanmate.webp', 'OceanMate', 166, 126), role: 'Travel' },
  { ...logo('p_emariners.webp', 'eMarinersApp', 289, 64), role: 'App partner' },
  { ...logo('p_healnrevive.webp', 'Heal & Revive', 135, 127), role: 'Wellness' },
  { ...logo('p_divulge.webp', 'Divulge', 200, 66), role: 'Corporate gifting' },
]

export const GLOBAL_PARTNERS: LandingLogo[] = [
  logo('g_cconsultant.webp', 'CConsultant Shipping Service', 165, 47),
  logo('g_cleanship.webp', 'Cleanship', 304, 83),
  logo('g_horizon.webp', 'Horizon', 100, 96),
  logo('g_gmg.webp', 'GMG Maritime Services', 88, 100),
  logo('g_hawk.webp', 'Hawk Marine Inspection & Consultancy', 241, 180),
  logo('g_ibhar.webp', 'ibhar', 140, 54),
  logo('g_kcs.webp', 'KCS', 100, 100),
  logo('g_mcss.webp', 'MCSS', 200, 100),
]

export const PARENT_GROUP_LOGO = logo('p_beaufort_marine.webp', 'Beaufort Marine Services LLP', 290, 77)
