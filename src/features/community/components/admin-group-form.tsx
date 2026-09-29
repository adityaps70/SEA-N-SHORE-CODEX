'use client'

import { useActionState } from 'react'
import { primaryButtonClass } from '@/components/ui/interactive-styles'
import { createGroupAsAdmin, setGroupOwnerAsAdmin, updateGroupAsAdmin, type AdminGroupFormState } from '../admin-actions'
import { GROUP_ICON_LABELS } from '../group-icons'
import { GROUP_DESCRIPTION_MAX_LENGTH, GROUP_ICON_NAMES, GROUP_NAME_MAX_LENGTH, GROUP_RULES_MAX_LENGTH, type AdminCommunityGroup } from '../types'

const inputClass = 'min-h-10 w-full rounded-lg border border-mist-200 bg-white px-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100'
const areaClass = 'w-full rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm leading-6 text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-muted'

function FormStatus({ state }: { state: AdminGroupFormState }) {
  if (!state) return null
  return state.ok
    ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{state.message}</p>
    : <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
}

/** Site admin: create a group (with its owner) or edit an existing one. */
export function AdminGroupForm({ group }: { group?: AdminCommunityGroup }) {
  const [state, action, pending] = useActionState(group ? updateGroupAsAdmin : createGroupAsAdmin, null)
  const formLabel = group ? `Edit ${group.name}` : 'Create group'
  return (
    <form action={action} aria-label={formLabel} className="space-y-4">
      {group ? <input type="hidden" name="groupId" value={group.id} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          Name
          <input name="name" required minLength={2} maxLength={GROUP_NAME_MAX_LENGTH} defaultValue={group?.name ?? ''} className={`${inputClass} mt-1 normal-case tracking-normal`} placeholder="e.g. Port Captains" />
        </label>
        {group ? null : (
          <label className={labelClass}>
            Owner (sign-in email or @handle)
            <input name="owner" required maxLength={320} className={`${inputClass} mt-1 normal-case tracking-normal`} placeholder="captain@example.com or @asha-singh" />
          </label>
        )}
        <label className={labelClass}>
          Visibility
          <select name="visibility" defaultValue={group?.visibility ?? 'public'} className={`${inputClass} mt-1 normal-case tracking-normal`}>
            <option value="public">Public — anyone can join and read</option>
            <option value="private">Private — admins approve join requests</option>
          </select>
        </label>
        <label className={labelClass}>
          Icon
          <select name="icon" defaultValue={group?.icon ?? ''} className={`${inputClass} mt-1 normal-case tracking-normal`}>
            <option value="">Default (people)</option>
            {GROUP_ICON_NAMES.map((name) => <option key={name} value={name}>{GROUP_ICON_LABELS[name]}</option>)}
          </select>
        </label>
      </div>
      <label className={labelClass}>
        Description
        <textarea name="description" rows={3} maxLength={GROUP_DESCRIPTION_MAX_LENGTH} defaultValue={group?.description ?? ''} className={`${areaClass} mt-1 normal-case tracking-normal`} />
      </label>
      <label className={labelClass}>
        Rules
        <textarea name="rules" rows={4} maxLength={GROUP_RULES_MAX_LENGTH} defaultValue={group?.rules ?? ''} className={`${areaClass} mt-1 normal-case tracking-normal`} />
      </label>
      <FormStatus state={state} />
      <button type="submit" disabled={pending} className={primaryButtonClass}>{pending ? 'Saving…' : group ? 'Save group' : 'Create group'}</button>
    </form>
  )
}

/** Site admin: hand a group to another member (the previous owner stays as an admin). */
export function AdminGroupOwnerForm({ group }: { group: AdminCommunityGroup }) {
  const [state, action, pending] = useActionState(setGroupOwnerAsAdmin, null)
  return (
    <form action={action} aria-label={`Change owner of ${group.name}`} className="space-y-3">
      <input type="hidden" name="groupId" value={group.id} />
      <label className={labelClass}>
        New owner (sign-in email or @handle)
        <input name="owner" required maxLength={320} className={`${inputClass} mt-1 normal-case tracking-normal`} placeholder="captain@example.com or @asha-singh" />
      </label>
      <p className="text-xs text-muted">Current owner: {group.owner ? group.owner.fullName : 'none'}. They stay in the group as an admin.</p>
      <FormStatus state={state} />
      <button type="submit" disabled={pending} className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50 disabled:opacity-60">
        {pending ? 'Saving…' : 'Set owner'}
      </button>
    </form>
  )
}
