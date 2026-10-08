'use client'

import { Fragment, useId } from 'react'
import { useFormResetKey } from './use-form-reset-key'
import { rolesFor, type RoleDepartment } from '../taxonomy'

export type RolePickerValue = {
  departmentKey: string
  roleKey: string
  otherText: string
}

export const EMPTY_ROLE_PICK: RolePickerValue = { departmentKey: '', roleKey: '', otherText: '' }

export type RolePickerStyles = {
  label: string
  select: string
  hint: string
  error: string
}

/** Same select styling as onboarding's other selects. */
export const onboardingPickerStyles: RolePickerStyles = {
  label: 'grid gap-2 text-sm font-medium text-navy-900',
  select: 'min-h-12 w-full rounded-xl border border-mist-100 bg-white px-4 text-base text-ink shadow-sm focus:border-ocean-700 disabled:cursor-not-allowed disabled:bg-mist-50 disabled:text-muted',
  hint: 'text-muted',
  error: 'text-red-700',
}

/** Same styling as the in-place profile card inputs. */
export const cardPickerStyles: RolePickerStyles = {
  label: 'block text-sm font-semibold text-navy-950',
  select: 'mt-1 min-h-10 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500 disabled:cursor-not-allowed disabled:bg-mist-50 disabled:text-muted',
  hint: 'mt-1 block text-xs font-normal text-muted',
  error: 'mt-1 block text-xs font-medium text-red-700',
}

type RolePickerProps = {
  departments: readonly RoleDepartment[]
  value: RolePickerValue
  onChange: (value: RolePickerValue) => void
  names?: { department: string; role: string; other: string }
  departmentLabel?: string
  roleLabel: string
  required?: boolean
  errors?: { department?: string; role?: string; other?: string }
  hint?: string
  styles?: RolePickerStyles
}

/**
 * Two linked selects, Department then Rank / Role (round 12). The second stays disabled until a
 * department is chosen; "Other (type your own)" shows a short text box. Plain selects, so it works
 * with the keyboard and the phone's native picker.
 */
export function RolePicker({
  departments,
  value,
  onChange,
  names = { department: 'roleDepartmentKey', role: 'roleKey', other: 'roleOtherText' },
  departmentLabel = 'Department',
  roleLabel,
  required = false,
  errors,
  hint,
  styles = onboardingPickerStyles,
}: RolePickerProps) {
  const id = useId()
  const departmentId = `${id}-department`
  const roleId = `${id}-role`
  const otherId = `${id}-other`
  const roles = rolesFor(value.departmentKey)
  const selectedRole = roles.find((role) => role.key === value.roleKey)
  const showOther = Boolean(selectedRole?.other)
  const roleDescription = errors?.role ?? hint
  const { ref, resetKey } = useFormResetKey<HTMLDivElement>()

  return (
    <Fragment key={resetKey}>
      <div ref={ref} className={styles.label}>
        <label htmlFor={departmentId}>{departmentLabel}</label>
        <select
          id={departmentId}
          name={names.department}
          value={value.departmentKey}
          required={required}
          aria-invalid={Boolean(errors?.department)}
          aria-describedby={errors?.department ? `${departmentId}-description` : undefined}
          onChange={(event) => onChange({ departmentKey: event.target.value, roleKey: '', otherText: '' })}
          className={styles.select}
        >
          <option value="">Choose a department</option>
          {departments.map((department) => (
            <option key={department.key} value={department.key}>{department.label}</option>
          ))}
        </select>
        {errors?.department ? <span id={`${departmentId}-description`} className={styles.error}>{errors.department}</span> : null}
      </div>
      <div className={styles.label}>
        <label htmlFor={roleId}>{roleLabel}</label>
        <select
          id={roleId}
          name={names.role}
          value={selectedRole ? value.roleKey : ''}
          required={required}
          disabled={!value.departmentKey}
          aria-invalid={Boolean(errors?.role)}
          aria-describedby={roleDescription ? `${roleId}-description` : undefined}
          onChange={(event) => onChange({ ...value, roleKey: event.target.value, otherText: '' })}
          className={styles.select}
        >
          <option value="">{value.departmentKey ? `Choose a ${roleLabel.toLocaleLowerCase('en').includes('rank') ? 'rank' : 'role'}` : 'Choose a department first'}</option>
          {roles.map((role) => (
            <option key={role.key} value={role.key}>{role.label}</option>
          ))}
        </select>
        {roleDescription ? (
          <span id={`${roleId}-description`} className={errors?.role ? styles.error : styles.hint}>{roleDescription}</span>
        ) : null}
      </div>
      {showOther ? (
        <div className={styles.label}>
          <label htmlFor={otherId}>Type your {roleLabel.toLocaleLowerCase('en').includes('rank') ? 'rank' : 'role'}</label>
          <input
            id={otherId}
            name={names.other}
            value={value.otherText}
            maxLength={100}
            required
            aria-invalid={Boolean(errors?.other)}
            aria-describedby={errors?.other ? `${otherId}-description` : undefined}
            onChange={(event) => onChange({ ...value, otherText: event.target.value })}
            className={styles.select}
          />
          {errors?.other ? <span id={`${otherId}-description`} className={styles.error}>{errors.other}</span> : null}
        </div>
      ) : null}
    </Fragment>
  )
}
