/**
 * A candidate's credentials for job matching, as JSON: the profile's credentials (not rejected) and, from learning
 * round B (B5), the Sea N Shore certificates the member shows on their profile, named by course title and always
 * verified. `profile` is the SQL alias of the candidate's profiles row.
 */
export function candidateCredentialsSql(profile: string) {
  return `coalesce((
      select json_agg(json_build_object(
        'name', credential.name,
        'expires_at', credential.expires_at,
        'verified', credential.verified
      ) order by credential.source asc, credential.sort_order asc, credential.issued desc nulls last, credential.name asc)
      from (
        select pc.name, pc.expires_on as expires_at, pc.verification_state = 'verified' as verified,
               0 as source, pc.sort_order, pc.issued_on as issued
        from public.profile_credentials pc
        where pc.profile_id = ${profile}.id and pc.verification_state <> 'rejected'
        union all
        select lc.course_title, (lc.expires_at at time zone 'UTC')::date, true,
               1, 0, (lc.issued_at at time zone 'UTC')::date
        from public.learning_certificates lc
        where lc.learner_id = ${profile}.id and lc.hidden_from_profile = false
      ) credential
    ), '[]'::json)`
}
