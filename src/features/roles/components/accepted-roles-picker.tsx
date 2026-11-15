'use client'

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { allRolesForPicker, departmentByKey, jobDepartments, normaliseRoleText, roleByKey, rolesFor, type RoleEntry } from '../taxonomy'

export type AcceptedRolesField = 'departmentKey' | 'acceptedRoleKeys' | 'roleOtherText'

export type AcceptedRolesValue = {
  departmentKey: string
  acceptedRoleKeys: string[]
  otherText: string
}

/** P6: a department's shared extra ranks (added by posters from other departments), most used first. */
export type SharedExtraRanks = Readonly<Record<string, ReadonlyArray<{ roleKey: string; timesUsed: number }>>>

export const MAX_ACCEPTED_ROLES = 20

/**
 * A job's Department, then the accepted ranks / roles (round 12): several can be ticked, for example Master and
 * Chief Officer "ready for command". Native select and checkboxes, so it works with the keyboard and on phones.
 *
 * P6 (owner-approved 13 Nov): below the department's own ranks come the ranks other posters added to this department
 * (tick boxes, never ticked for you), then "Add ranks from other departments": a searchable list of every existing
 * rank, grouped by department, several at a time, shown as removable chips. Members no longer type ranks; an older
 * job's typed "Other" stays as it was. Every selection is a named form input, so autosave and restore keep it.
 */
export function AcceptedRolesPicker({
  value,
  onChange,
  labelClassName,
  inputClassName,
  idPrefix,
  errors,
  sharedExtras,
}: {
  value: AcceptedRolesValue
  onChange: (value: AcceptedRolesValue) => void
  labelClassName: string
  inputClassName: string
  /** Stable field ids (`<prefix>-departmentKey`, …) so an error summary can link to them. */
  idPrefix?: string
  /** Hotfix P2: a message under each field, with aria-invalid and aria-describedby. */
  errors?: Partial<Record<AcceptedRolesField, string>>
  sharedExtras?: SharedExtraRanks
}) {
  const generatedId = useId()
  const id = idPrefix ?? generatedId
  const departmentId = idPrefix ? `${idPrefix}-departmentKey` : `${id}-department`
  const rolesId = idPrefix ? `${idPrefix}-acceptedRoleKeys` : `${id}-roles`
  const otherId = idPrefix ? `${idPrefix}-roleOtherText` : `${id}-other`
  const issueId = (field: AcceptedRolesField) => `${id}-${field}-issue`
  const issue = (field: AcceptedRolesField) => errors?.[field]
    ? <span id={issueId(field)} className="block text-xs font-medium text-red-700">{errors[field]}</span>
    : null
  const departments = jobDepartments()
  const ownRoles = rolesFor(value.departmentKey, value.acceptedRoleKeys)
  // "Other (type your own)" is no longer offered; an older job that already has it keeps it (and its text).
  const listedOwn = ownRoles.filter((role) => !role.other || value.acceptedRoleKeys.includes(role.key))
  const otherSelected = ownRoles.some((role) => role.other && value.acceptedRoleKeys.includes(role.key))
  const shared = (sharedExtras?.[value.departmentKey] ?? [])
    .map((entry) => roleByKey(entry.roleKey))
    .filter((role): role is RoleEntry => Boolean(role && !role.other && role.department !== value.departmentKey))
  const sharedKeys = new Set(shared.map((role) => role.key))
  // Ranks from other departments picked here that are not (yet) shared tick boxes: chips with hidden inputs.
  const chips = value.acceptedRoleKeys
    .map((key) => roleByKey(key))
    .filter((role): role is RoleEntry => Boolean(role && !role.other && role.department !== value.departmentKey && !sharedKeys.has(role.key)))
  const full = value.acceptedRoleKeys.length >= MAX_ACCEPTED_ROLES

  function toggle(key: string) {
    const selected = value.acceptedRoleKeys.includes(key)
    if (!selected && full) return
    const acceptedRoleKeys = selected ? value.acceptedRoleKeys.filter((entry) => entry !== key) : [...value.acceptedRoleKeys, key]
    onChange({ ...value, acceptedRoleKeys })
  }

  const box = (role: RoleEntry, note?: string) => {
    const checked = value.acceptedRoleKeys.includes(role.key)
    return (
      <label
        key={role.key}
        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
          checked ? 'border-ocean-500 bg-ocean-50 text-navy-950' : 'border-mist-100 bg-white text-navy-900 hover:border-ocean-300'
        }`}
      >
        <input type="checkbox" name="acceptedRoleKeys" value={role.key} checked={checked} disabled={!checked && full} onChange={() => toggle(role.key)} />
        <span>{role.label}{note ? <span className="ml-1 text-xs font-normal text-muted">{note}</span> : null}</span>
      </label>
    )
  }

  return (
    <>
      <div className={labelClassName}>
        <label htmlFor={departmentId}>Department</label>
        <select
          id={departmentId}
          name="departmentKey"
          value={value.departmentKey}
          required
          aria-invalid={errors?.departmentKey ? true : undefined}
          aria-describedby={errors?.departmentKey ? issueId('departmentKey') : undefined}
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
        {issue('departmentKey')}
      </div>

      <fieldset
        id={rolesId}
        className="rounded-xl border border-mist-100 p-4 sm:col-span-2"
        aria-describedby={[`${id}-roles-hint`, errors?.acceptedRoleKeys ? issueId('acceptedRoleKeys') : null].filter(Boolean).join(' ')}
        aria-invalid={errors?.acceptedRoleKeys ? true : undefined}
        disabled={!value.departmentKey}
      >
        <legend className="px-1 text-sm font-semibold text-navy-900">Accepted ranks / roles</legend>
        <p id={`${id}-roles-hint`} className="text-xs text-muted">
          {value.departmentKey
            ? 'Tick every rank or role you will consider. Candidates one level more senior also match.'
            : 'Choose a department first.'}
        </p>
        {value.departmentKey ? (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {listedOwn.map((role) => box(role))}
            </div>
            {shared.length ? (
              <div className="mt-4" role="group" aria-labelledby={`${id}-shared-extras`}>
                <p id={`${id}-shared-extras`} className="text-xs font-semibold text-navy-900">Also added for this department by other posters</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {shared.map((role) => box(role, `(${departmentByKey(role.department)?.label ?? ''})`))}
                </div>
              </div>
            ) : null}
            <OtherDepartmentRanks
              id={id}
              departmentKey={value.departmentKey}
              selectedKeys={value.acceptedRoleKeys}
              full={full}
              onToggle={toggle}
            />
            {chips.length ? (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Ranks added from other departments">
                {chips.map((role) => (
                  <li key={role.key} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-ocean-500 bg-ocean-50 py-1 pl-3 pr-1 text-sm font-medium text-navy-950">
                    {role.label}
                    <span className="text-xs font-normal text-muted">({departmentByKey(role.department)?.label})</span>
                    <input type="hidden" name="acceptedRoleKeys" value={role.key} />
                    <button
                      type="button"
                      onClick={() => toggle(role.key)}
                      aria-label={`Remove ${role.label}`}
                      className="inline-flex size-7 items-center justify-center rounded-full text-navy-900 hover:bg-white"
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {full ? <p role="status" className="mt-2 text-xs text-muted">You have chosen the maximum of {MAX_ACCEPTED_ROLES} ranks / roles.</p> : null}
          </>
        ) : null}
        {issue('acceptedRoleKeys')}
        {otherSelected ? (
          <div className={`${labelClassName} mt-3`}>
            <label htmlFor={otherId}>Rank / role typed on this older job</label>
            <input
              id={otherId}
              name="roleOtherText"
              value={value.otherText}
              maxLength={100}
              required
              aria-invalid={errors?.roleOtherText ? true : undefined}
              aria-describedby={errors?.roleOtherText ? issueId('roleOtherText') : undefined}
              onChange={(event) => onChange({ ...value, otherText: event.target.value })}
              className={inputClassName}
            />
            {issue('roleOtherText')}
          </div>
        ) : null}
      </fieldset>
    </>
  )
}

type Option = { role: RoleEntry; groupLabel: string }

/**
 * "Add ranks from other departments": an ARIA combobox over every existing rank outside this department, grouped
 * by department and searchable by name or synonym. Choosing a rank adds it (or removes it if already chosen) and
 * keeps the list open, so several can be picked; chosen ones show a tick.
 */
function OtherDepartmentRanks({ id, departmentKey, selectedKeys, full, onToggle }: {
  id: string
  departmentKey: string
  selectedKeys: readonly string[]
  full: boolean
  onToggle: (key: string) => void
}) {
  const listId = `${id}-other-ranks`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listRef = useRef<HTMLUListElement | null>(null)
  const options = useMemo<Option[]>(() => allRolesForPicker()
    .filter((role) => role.department !== departmentKey)
    .map((role) => ({ role, groupLabel: departmentByKey(role.department)?.label ?? role.department })), [departmentKey])
  const results = useMemo(() => {
    const term = normaliseRoleText(query)
    if (!term) return options
    return options.filter(({ role, groupLabel }) => [role.label, ...role.synonyms, groupLabel].some((text) => normaliseRoleText(text).includes(term)))
  }, [options, query])
  const expanded = open && results.length > 0

  function move(next: number) {
    setActive(next)
    listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }

  function pick(index: number) {
    const option = results[index]
    if (!option) return
    if (full && !selectedKeys.includes(option.role.key)) return
    onToggle(option.role.key)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        move(0)
        return
      }
      if (!results.length) return
      if (event.key === 'ArrowDown') move(active < results.length - 1 ? active + 1 : 0)
      else move(active > 0 ? active - 1 : results.length - 1)
      return
    }
    if (event.key === 'Enter' && expanded && active >= 0) {
      event.preventDefault()
      pick(active)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className="relative mt-4">
      <label htmlFor={`${listId}-input`} className="block text-xs font-semibold text-navy-900">Add ranks from other departments</label>
      <p id={`${listId}-hint`} className="text-xs text-muted">Any existing rank or role, for example a Master or Chief Officer for a shore job. Choose as many as you need.</p>
      <div className="relative mt-2">
        <input
          id={`${listId}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-describedby={`${listId}-hint`}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder="Search ranks, e.g. Chief Officer, 2/E, ETO"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(event.target.value.trim() ? 0 : -1)
          }}
          onBlur={() => {
            setOpen(false)
            setActive(-1)
          }}
          onKeyDown={onKeyDown}
          className="block min-h-11 w-full rounded-xl border border-mist-200 bg-white py-2 pl-3 pr-9 text-sm text-navy-950 focus:border-teal-500"
        />
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      </div>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Ranks from other departments"
        aria-multiselectable="true"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-mist-100 bg-white py-1 text-sm shadow-[var(--shadow-card)]"
      >
        {expanded ? results.map((option, index) => {
          const selected = selectedKeys.includes(option.role.key)
          const startsGroup = index === 0 || results[index - 1]!.groupLabel !== option.groupLabel
          return (
            <li
              key={option.role.key}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={selected}
              aria-disabled={!selected && full ? true : undefined}
              onMouseDown={(event) => {
                // mousedown, not click: the input keeps focus, so its blur does not close the list first.
                event.preventDefault()
                pick(index)
              }}
              className={cn(
                'cursor-pointer px-3 py-2',
                index === active ? 'bg-ocean-50 text-navy-950' : 'text-navy-900 hover:bg-mist-50',
                !selected && full && 'cursor-not-allowed opacity-50',
              )}
            >
              {startsGroup ? <span aria-hidden="true" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{option.groupLabel}</span> : null}
              <span className="flex min-h-7 items-center gap-2">
                <span aria-hidden="true" className={cn('inline-flex size-4 items-center justify-center rounded border', selected ? 'border-ocean-500 bg-ocean-500 text-white' : 'border-mist-200')}>
                  {selected ? <Check className="size-3" /> : null}
                </span>
                {option.role.label}
                <span className="sr-only">, {option.groupLabel}{selected ? ', selected' : ''}</span>
              </span>
            </li>
          )
        }) : null}
      </ul>
      {open && !results.length ? <p role="status" className="mt-1 text-xs text-muted">No rank matches. An admin can add a missing rank.</p> : null}
    </div>
  )
}
