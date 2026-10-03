/**
 * The profile type matching uses (round 12): the persona, or for a profile from before personas
 * its legacy type, mapped the same way as rankPersonaFor / personaForProfile. Shared by the
 * candidate's own match and the recruiter's applicant list so both show the same numbers. Used for
 * matching only, never for authorization.
 */
export function matchPersonaSql(alias: string) {
  return `coalesce(${alias}.persona, case ${alias}.profile_type::text
      when 'seafarer' then 'seafarer'
      when 'recruiter' then 'recruiter_hr'
      when 'trainer' then 'trainer_instructor'
      else 'shore_professional'
    end)`
}
