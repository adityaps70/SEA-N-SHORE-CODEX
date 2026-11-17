import {
  COUNTRY_DIAL_CODES,
  COUNTRY_DIAL_CODE_MAX_LENGTH,
  COUNTRY_NAME_KEYS,
  COUNTRY_TEXT_ACCENTS_FROM,
  COUNTRY_TEXT_ACCENTS_TO,
} from './catalog'

/**
 * Round GP (Global Partners): each member's country for Admin, worked out when Admin reads it and never written back.
 * In order, the first one found:
 *   1. profile      profiles.country_of_residence, the country the member chose;
 *   2. location     their free-text location clearly names a country ("Manila, Philippines")   — estimated;
 *   3. phone        the dialling code of a phone number on one of their sign-ins                — estimated;
 *   4. signup       the country recorded when they signed up, else the country of their earliest stored sign-in
 *                   session (both from CloudFront's viewer-country header, code only)           — estimated.
 * Every step is an equality join (hash joins), so the whole member list is a handful of scans, not a loop per member.
 */
export const MEMBER_COUNTRY_SOURCES = ['profile', 'location', 'phone', 'signup'] as const
export type MemberCountrySource = (typeof MEMBER_COUNTRY_SOURCES)[number]

export function isEstimatedCountrySource(source: string | null | undefined): boolean {
  return source === 'location' || source === 'phone' || source === 'signup'
}

/** The same normalisation as normaliseCountryText, in Postgres. */
export function countryTextSql(expression: string) {
  return `btrim(regexp_replace(translate(lower(${expression}), '${COUNTRY_TEXT_ACCENTS_FROM}', '${COUNTRY_TEXT_ACCENTS_TO}'), '[^a-z0-9]+', ' ', 'g'))`
}

const NAMES_JSON = JSON.stringify([...COUNTRY_NAME_KEYS].map(([alias, code]) => ({ alias, code })))
const DIALS_JSON = JSON.stringify([...COUNTRY_DIAL_CODES].map(([prefix, code]) => ({ prefix, code })))

/** The two values the CTEs read: the country name keys and the dialling codes, as JSON. */
export function memberCountryValues(): [names: string, dials: string] {
  return [NAMES_JSON, DIALS_JSON]
}

type Placeholder = (position: number) => string
const dollar: Placeholder = (position) => `${String.fromCharCode(36)}${position}`

/**
 * The CTEs (no leading "with") ending in `member_country (profile_id, code, source)`, one row per profile; code and
 * source are null when nothing is known. `namesParam` / `dialsParam` are the positions of memberCountryValues();
 * `profileIdsParam`, when given, is a uuid[] parameter that limits the work to those profiles.
 */
export function memberCountryCtes(input: { namesParam: number; dialsParam: number; profileIdsParam?: number }) {
  const only = (column: string) => (input.profileIdsParam ? ` and ${column} = any(${dollar(input.profileIdsParam)}::uuid[])` : '')
  return `country_names as materialized (
    select n.alias, n.code from jsonb_to_recordset(${dollar(input.namesParam)}::jsonb) as n(alias text, code text)
  ),
  country_dials as materialized (
    select d.prefix, d.code from jsonb_to_recordset(${dollar(input.dialsParam)}::jsonb) as d(prefix text, code text)
  ),
  member_location_text as (
    select p.id as profile_id,
           ${countryTextSql('p.location')} as whole_key,
           case when strpos(p.location, ',') > 0 then ${countryTextSql("split_part(p.location, ',', -1)")} end as last_key
    from public.profiles p
    where p.country_of_residence is null and p.location is not null${only('p.id')}
  ),
  member_location_country as (
    select t.profile_id, coalesce(w.code, l.code) as code
    from member_location_text t
    left join country_names w on w.alias = t.whole_key
    left join country_names l on l.alias = t.last_key
    where coalesce(w.code, l.code) is not null
  ),
  member_phone_country as (
    select distinct on (ia.profile_id) ia.profile_id, d.code
    from public.identity_accounts ia
    cross join generate_series(1, ${COUNTRY_DIAL_CODE_MAX_LENGTH}) as prefix_length(n)
    join country_dials d on d.prefix = substr(ia.phone_number, 2, prefix_length.n)
    where ia.phone_number like '+%'${only('ia.profile_id')}
    order by ia.profile_id, ia.phone_number_verified desc, ia.id, prefix_length.n desc
  ),
  member_first_session_country as (
    select distinct on (s.profile_id) s.profile_id, s.approx_country as code
    from public.auth_sessions s
    where s.approx_country is not null${only('s.profile_id')}
    order by s.profile_id, s.created_at asc, s.id asc
  ),
  member_country as (
    select p.id as profile_id,
           coalesce(p.country_of_residence, lc.code, pc.code, sc.country_code, fs.code) as code,
           case
             when p.country_of_residence is not null then 'profile'
             when lc.code is not null then 'location'
             when pc.code is not null then 'phone'
             when sc.country_code is not null or fs.code is not null then 'signup'
           end as source
    from public.profiles p
    left join member_location_country lc on lc.profile_id = p.id
    left join member_phone_country pc on pc.profile_id = p.id
    left join public.member_signup_countries sc on sc.profile_id = p.id
    left join member_first_session_country fs on fs.profile_id = p.id
    where true${only('p.id')}
  )`
}

/** Who Admin counts as a registered member: active, finished onboarding, not a load-test account. */
export const REGISTERED_MEMBER_SQL = (alias: string) =>
  `${alias}.account_status = 'active' and ${alias}.onboarding_completed_at is not null and not ${alias}.is_load_test`

/** A member with at least one approved Sea N Shore verification (the badge on their profile card). */
export const VERIFIED_MEMBER_SQL = (alias: string) =>
  `exists (select 1 from public.feature_verifications fv where fv.profile_id = ${alias}.id and fv.status = 'approved')`
