/**
 * Learning round D (D2): the certificate's attendance rule in SQL, the same rule as `attendanceSummary` and
 * `attendanceRuleMet` in session-rules.ts. True when the course has no minimum, the learner is not in a batch, the
 * batch has no sessions left to count, or present ÷ (scheduled sessions − excused) reaches the minimum. A learner who
 * joined a session that has started counts as present until a trainer marks them otherwise.
 */
export function attendanceRuleMetSql(enrollmentAlias = 'enrollment', courseAlias = 'course') {
  const e = enrollmentAlias
  const c = courseAlias
  return `(
    ${c}.min_attendance_percent is null
    or ${e}.batch_id is null
    or (
      select count(*) filter (where coalesce(rule_attendance.status, '') <> 'excused') = 0
        or count(*) filter (
             where rule_attendance.status = 'present'
                or (rule_attendance.status is null and rule_attendance.first_joined_at is not null and rule_session.starts_at <= now())
           ) * 100 >= ${c}.min_attendance_percent * count(*) filter (where coalesce(rule_attendance.status, '') <> 'excused')
      from public.learning_batch_sessions rule_session
      left join public.learning_session_attendance rule_attendance
        on rule_attendance.session_id = rule_session.id and rule_attendance.enrollment_id = ${e}.id
      where rule_session.batch_id = ${e}.batch_id and rule_session.status = 'scheduled'
    )
  )`
}
