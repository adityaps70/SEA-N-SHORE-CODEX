'use client'

import { useId } from 'react'
import { jobDepartments, rolesFor } from '../taxonomy'

export type AcceptedRolesValue = {
  departmentKey: string
  acceptedRoleKeys: string[]
  otherText: string
}

/**
 * A job's Department, then the accepted ranks / roles inside it (round 12): several can be ticked,
 * for example Master and Chief Officer "ready for command". "Other (type your own)" shows a short
 * text box. Native select and checkboxes, so it works with the keyboard and on phones.
 */
export function AcceptedRolesPicker({
  value,
  onChange,
  labelClassName,
  inputClassName,
}: {
  value: AcceptedRolesValue
  onChange: (value: AcceptedRolesValue) => void
  labelClassName: string
  inputClassName: string
}) {
  const id = useId()
  const departments = jobDepartments()
  const roles = rolesFor(value.departmentKey)
  const otherSelected = roles.some((role) => role.other && value.acceptedRoleKeys.includes(role.key))

  function toggle(key: string) {
    const selected = value.acceptedRoleKeys.includes(key)
    const acceptedRoleKeys = selected ? value.acceptedRoleKeys.filter((entry) => entry !== key) : [...value.acceptedRoleKeys, key]
    onChange({ ...value, acceptedRoleKeys })
  }

  return (
    <>
      <div className={labelClassName}>
        <label htmlFor={`${id}-department`}>Department</label>
        <select
          id={`${id}-department`}
          name="departmentKey"
          value={value.departmentKey}
          required
          onChange={(event) => onChange({ departmentKey: event.target.value, acceptedRoleKeys: [], otherText: '' })}
          className={inputClassName}
        >
          <option value="">Choose a department</option>
          <optgroup label="Sea-going">
            {departments.filter((department) => department.domain === 'sea').map((department) => (
              <option key={department.key} value={department.key}>{department.label}</option>
            ))}
          </optgroup>
          <optgroup label="Shore-based">
            {departments.filter((department) => department.domain === 'shore').map((department) => (
              <option key={department.key} value={department.key}>{department.label}</option>
            ))}
          </optgroup>
        </select>
      </div>

      <fieldset className="rounded-xl border border-mist-100 p-4 sm:col-span-2" aria-describedby={`${id}-roles-hint`} disabled={!value.departmentKey}>
        <legend className="px-1 text-sm font-semibold text-navy-900">Accepted ranks / roles</legend>
        <p id={`${id}-roles-hint`} className="text-xs text-muted">
          {value.departmentKey
            ? 'Tick every rank or role you will consider. Candidates one level more senior also match.'
            : 'Choose a department first.'}
        </p>
        {value.departmentKey ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {roles.map((role) => {
              const checked = value.acceptedRoleKeys.includes(role.key)
              return (
                <label
                  key={role.key}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    checked ? 'border-ocean-500 bg-ocean-50 text-navy-950' : 'border-mist-100 bg-white text-navy-900 hover:border-ocean-300'
                  }`}
                >
                  <input type="checkbox" name="acceptedRoleKeys" value={role.key} checked={checked} onChange={() => toggle(role.key)} />
                  {role.label}
                </label>
              )
            })}
          </div>
        ) : null}
        {otherSelected ? (
          <div className={`${labelClassName} mt-3`}>
            <label htmlFor={`${id}-other`}>Type the rank / role</label>
            <input
              id={`${id}-other`}
              name="roleOtherText"
              value={value.otherText}
              maxLength={100}
              required
              onChange={(event) => onChange({ ...value, otherText: event.target.value })}
              className={inputClassName}
            />
          </div>
        ) : null}
      </fieldset>
    </>
  )
}
