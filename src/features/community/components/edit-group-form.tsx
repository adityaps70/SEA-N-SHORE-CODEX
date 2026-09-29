'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import { updateGroup } from '../actions'
import { GROUP_ICON_LABELS } from '../group-icons'
import { GROUP_DESCRIPTION_MAX_LENGTH, GROUP_ICON_NAMES, GROUP_RULES_MAX_LENGTH, type CommunityGroup, type GroupJoinPolicy } from '../types'

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100'
const areaClass = 'w-full rounded-xl border border-mist-200 bg-white px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100'
const choiceClass = 'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-mist-200 bg-white px-3 py-2.5 text-sm text-navy-950 transition hover:bg-mist-50 has-[:checked]:border-ocean-400 has-[:checked]:bg-ocean-50'

export const JOIN_POLICY_OPTIONS: Array<{ value: GroupJoinPolicy; label: string; hint: string }> = [
  { value: 'open', label: 'Open — anyone can join', hint: 'Members join at once.' },
  { value: 'approval', label: 'Approval required — a moderator approves requests', hint: 'Requests wait on the Members tab. Switching to Open keeps waiting requests until you approve them.' },
]

/** Moderators edit the description, rules, visibility, join setting and icon (the name stays). */
export function EditGroupForm({ group, doneHref }: { group: CommunityGroup; doneHref: string }) {
  const router = useRouter()
  const [description, setDescription] = useState(group.description)
  const [rules, setRules] = useState(group.rules)
  const [visibility, setVisibility] = useState(group.visibility)
  const [joinPolicy, setJoinPolicy] = useState<GroupJoinPolicy>(group.joinPolicy)
  const [icon, setIcon] = useState(group.icon ?? '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    startTransition(async () => {
      const result = await updateGroup({ groupId: group.id, description, rules, visibility, joinPolicy, icon: icon || null }).catch(() => null)
      if (!result || !result.ok) {
        setError(result?.error ?? 'We could not save the group. Check your connection and try again.')
        return
      }
      setSaved(true)
      router.push(doneHref)
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} aria-label={`Edit ${group.name}`} className="space-y-4">
      <label className="block text-sm font-semibold text-navy-950">
        Description
        <textarea name="description" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={GROUP_DESCRIPTION_MAX_LENGTH} className={`${areaClass} mt-1.5`} />
      </label>
      <label className="block text-sm font-semibold text-navy-950">
        Rules
        <textarea name="rules" value={rules} onChange={(event) => setRules(event.target.value)} rows={5} maxLength={GROUP_RULES_MAX_LENGTH} className={`${areaClass} mt-1.5`} placeholder="What members should know before posting." />
      </label>
      <fieldset>
        <legend className="text-sm font-semibold text-navy-950">Join setting</legend>
        <div className="mt-1.5 grid gap-2">
          {JOIN_POLICY_OPTIONS.map((option) => (
            <label key={option.value} className={choiceClass}>
              <input type="radio" name="joinPolicy" value={option.value} checked={joinPolicy === option.value} onChange={() => setJoinPolicy(option.value)} className="mt-1 size-4 accent-ocean-700" />
              <span className="min-w-0">
                <span className="block font-semibold">{option.label}</span>
                <span className="block text-xs font-normal text-muted">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-navy-950">
          Visibility
          <select name="visibility" value={visibility} onChange={(event) => setVisibility(event.target.value === 'private' ? 'private' : 'public')} className={`${inputClass} mt-1.5`}>
            <option value="public">Public — anyone can read the posts and see the members</option>
            <option value="private">Private — posts and members are visible to members only</option>
          </select>
        </label>
        <label className="block text-sm font-semibold text-navy-950">
          Icon
          <select name="icon" value={icon} onChange={(event) => setIcon(event.target.value)} className={`${inputClass} mt-1.5`}>
            <option value="">Default (people)</option>
            {GROUP_ICON_NAMES.map((name) => <option key={name} value={name}>{GROUP_ICON_LABELS[name]}</option>)}
          </select>
        </label>
      </div>
      {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {saved ? <p role="status" className="text-sm font-semibold text-emerald-800">Saved.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primaryButtonClass}>{pending ? 'Saving…' : 'Save changes'}</button>
        <button type="button" disabled={pending} onClick={() => router.push(doneHref)} className={secondaryButtonClass}>Cancel</button>
      </div>
    </form>
  )
}
