'use client'

import { Fragment, useState } from 'react'
import { useFormResetKey } from './use-form-reset-key'
import type { Persona } from '@/features/profiles/persona'
import { ROLE_FIELDS_MARKER } from '../profile-role-input'
import {
  CADET_COURSES,
  CADET_STAGES,
  departmentsFor,
  defaultTargetRoleFor,
  normaliseLegacyRankForPersona,
  personaPicksRole,
  roleByKey,
} from '../taxonomy'
import {
  EMPTY_ROLE_PICK,
  RolePicker,
  cardPickerStyles,
  onboardingPickerStyles,
  type RolePickerStyles,
  type RolePickerValue,
} from './role-picker'

export type ProfileRoleInitialValues = {
  roleDepartmentKey?: string | null
  roleKey?: string | null
  roleOtherText?: string | null
  cadetStageKey?: string | null
  cadetCourseKey?: string | null
  targetDepartmentKey?: string | null
  targetRoleKey?: string | null
  occupationText?: string | null
  /** The old free-text rank, shown as a hint and used to pre-select a recognised rank. */
  legacyRank?: string | null
}

type ErrorLookup = (name: string) => string | undefined

function pickFor(departmentKey: string | null | undefined, roleKey: string | null | undefined, otherText?: string | null): RolePickerValue {
  const role = roleByKey(roleKey)
  const department = role?.department ?? departmentKey ?? ''
  return { departmentKey: department, roleKey: role ? role.key : '', otherText: role?.other ? otherText ?? '' : '' }
}

function initialRolePick(persona: Persona, initial: ProfileRoleInitialValues): RolePickerValue {
  if (initial.roleKey || initial.roleDepartmentKey) return pickFor(initial.roleDepartmentKey, initial.roleKey, initial.roleOtherText)
  const recognised = normaliseLegacyRankForPersona(initial.legacyRank, persona)
  return recognised ? pickFor(null, recognised) : EMPTY_ROLE_PICK
}

/** A pick that is not in the persona's departments is shown empty; a one-department persona starts on it. */
function effectivePick(persona: Persona, value: RolePickerValue): RolePickerValue {
  const departments = departmentsFor(persona)
  if (value.departmentKey && departments.some((department) => department.key === value.departmentKey)) return value
  return departments.length === 1 ? { ...EMPTY_ROLE_PICK, departmentKey: departments[0].key } : EMPTY_ROLE_PICK
}

function roleLabelFor(persona: Persona) {
  if (persona === 'seafarer') return 'Current or most recent rank'
  return 'Role'
}

function departmentLabelFor(persona: Persona) {
  return persona === 'shore_professional' ? 'Department (function)' : 'Department'
}

/**
 * The structured role questions for a profile type (round 12), used by onboarding and every profile
 * editor: Department → Rank for seafarers; Department → Role for shore professionals, recruiters and
 * trainers; current stage, course and target job role for students and cadets; and only an optional
 * occupation for seafarer families, maritime enthusiasts and others.
 */
export function ProfileRoleFields({
  persona,
  initial = {},
  error = () => undefined,
  variant = 'onboarding',
}: {
  persona: Persona
  initial?: ProfileRoleInitialValues
  error?: ErrorLookup
  variant?: 'onboarding' | 'card'
}) {
  const styles: RolePickerStyles = variant === 'card' ? cardPickerStyles : onboardingPickerStyles
  // null until the member picks: the saved rank (or a recognised old rank text) for the current profile type.
  const [pickedRole, setRolePick] = useState<RolePickerValue | null>(null)
  const rolePick = pickedRole ?? initialRolePick(persona, initial)
  const [stage, setStage] = useState(initial.cadetStageKey ?? '')
  const [course, setCourse] = useState(initial.cadetCourseKey ?? '')
  const [targetPick, setTargetPick] = useState<RolePickerValue>(() => {
    if (initial.targetRoleKey || initial.targetDepartmentKey) return pickFor(initial.targetDepartmentKey, initial.targetRoleKey, initial.roleOtherText)
    const suggested = defaultTargetRoleFor(initial.cadetStageKey, initial.cadetCourseKey)
    return suggested ? pickFor(null, suggested) : EMPTY_ROLE_PICK
  })
  const [targetTouched, setTargetTouched] = useState(Boolean(initial.targetRoleKey))
  const [occupation, setOccupation] = useState(initial.occupationText ?? '')

  function suggestTarget(nextStage: string, nextCourse: string) {
    if (targetTouched) return
    const suggested = defaultTargetRoleFor(nextStage, nextCourse)
    setTargetPick(suggested ? pickFor(null, suggested) : EMPTY_ROLE_PICK)
  }

  const legacyRank = initial.legacyRank?.trim()
  const { ref: markerRef, resetKey } = useFormResetKey<HTMLInputElement>()
  const marker = <input ref={markerRef} type="hidden" name={ROLE_FIELDS_MARKER} value="1" />

  if (persona === 'student_cadet') {
    const stageId = 'profile-role-cadet-stage'
    const courseId = 'profile-role-cadet-course'
    return (
      <Fragment key={resetKey}>
        {marker}
        <div className={styles.label}>
          <label htmlFor={stageId}>Current stage</label>
          <select
            id={stageId}
            name="cadetStageKey"
            value={stage}
            required
            aria-invalid={Boolean(error('cadetStageKey'))}
            onChange={(event) => {
              setStage(event.target.value)
              suggestTarget(event.target.value, course)
            }}
            className={styles.select}
          >
            <option value="">Choose your stage</option>
            {CADET_STAGES.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          </select>
          {error('cadetStageKey') ? <span className={styles.error}>{error('cadetStageKey')}</span> : null}
        </div>
        {stage === 'pre_sea' ? (
          <div className={styles.label}>
            <label htmlFor={courseId}>Course</label>
            <select
              id={courseId}
              name="cadetCourseKey"
              value={course}
              aria-invalid={Boolean(error('cadetCourseKey'))}
              onChange={(event) => {
                setCourse(event.target.value)
                suggestTarget(stage, event.target.value)
              }}
              className={styles.select}
            >
              <option value="">Choose your course</option>
              {CADET_COURSES.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
            {error('cadetCourseKey') ? <span className={styles.error}>{error('cadetCourseKey')}</span> : null}
          </div>
        ) : null}
        <RolePicker
          departments={departmentsFor('student_cadet')}
          value={targetPick}
          onChange={(value) => {
            setTargetTouched(true)
            setTargetPick(value)
          }}
          names={{ department: 'targetDepartmentKey', role: 'targetRoleKey', other: 'roleOtherText' }}
          departmentLabel="Target department"
          roleLabel="Target job role (rank / role)"
          required
          hint="The job you are working towards. Jobs are matched against it."
          errors={{ department: error('targetDepartmentKey'), role: error('targetRoleKey'), other: error('roleOtherText') }}
          styles={styles}
        />
      </Fragment>
    )
  }

  if (personaPicksRole(persona)) {
    const recognised = Boolean(normaliseLegacyRankForPersona(legacyRank, persona))
    const hint = legacyRank && !initial.roleKey && !recognised
      ? `Saved as “${legacyRank}”. Pick it from the list so jobs can match you.`
      : persona === 'seafarer' ? 'Shown next to your name on posts.' : undefined
    return (
      <>
        {marker}
        <RolePicker
          departments={departmentsFor(persona)}
          value={effectivePick(persona, rolePick)}
          onChange={setRolePick}
          departmentLabel={departmentLabelFor(persona)}
          roleLabel={roleLabelFor(persona)}
          required={persona === 'seafarer'}
          hint={hint}
          errors={{ department: error('roleDepartmentKey'), role: error('roleKey') ?? error('rank'), other: error('roleOtherText') }}
          styles={styles}
        />
      </>
    )
  }

  const occupationId = 'profile-role-occupation'
  return (
    <Fragment key={resetKey}>
      {marker}
      <div className={styles.label}>
        <label htmlFor={occupationId}>Occupation / role <span className="font-normal text-muted">(optional)</span></label>
        <input
          id={occupationId}
          name="occupationText"
          value={occupation}
          maxLength={120}
          onChange={(event) => setOccupation(event.target.value)}
          aria-invalid={Boolean(error('occupationText'))}
          aria-describedby={`${occupationId}-description`}
          className={styles.select}
        />
        <span id={`${occupationId}-description`} className={error('occupationText') ? styles.error : styles.hint}>
          {error('occupationText') ?? 'For example: Web developer. Shown on your profile.'}
        </span>
      </div>
      {legacyRank ? (
        <label className={`${styles.hint} flex items-center gap-2`}>
          <input type="checkbox" name="clearRank" className="size-4 rounded border-mist-200 accent-ocean-700" />
          Remove “{legacyRank}” from next to my name
        </label>
      ) : null}
    </Fragment>
  )
}
