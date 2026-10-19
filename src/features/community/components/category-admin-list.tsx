'use client'

import { useState, useTransition, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical } from 'lucide-react'
import {
  deleteCommunityCategory,
  moveCommunityCategory,
  moveCommunityCategoryCommunities,
  setCommunityCategoryHidden,
  updateCommunityCategory,
} from '../category-admin-actions'
import { GROUP_ICON_LABELS, GroupIcon } from '../group-icons'
import {
  COMMUNITY_CATEGORY_DESCRIPTION_MAX_LENGTH,
  COMMUNITY_CATEGORY_NAME_MAX_LENGTH,
  GROUP_ICON_NAMES,
  type CommunityCategoryRecord,
} from '../types'

const inputClass = 'min-h-10 w-full rounded-lg border border-mist-200 bg-white px-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100'
const smallButton = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-mist-200 bg-white px-2.5 text-sm font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50 disabled:cursor-not-allowed disabled:opacity-50'
const dangerButton = 'inline-flex min-h-9 items-center rounded-lg border border-red-200 bg-white px-2.5 text-sm font-semibold text-red-700 hover:bg-red-50'

/** The icon picker of the add and edit forms: the community icon set. */
export function CategoryIconSelect({ id, defaultValue = '' }: { id: string; defaultValue?: string | null }) {
  return (
    <label htmlFor={id} className="block text-sm font-semibold text-navy-950">
      Icon (optional)
      <select id={id} name="icon" defaultValue={defaultValue ?? ''} className={`${inputClass} mt-1`}>
        <option value="">Default (people)</option>
        {GROUP_ICON_NAMES.map((name) => <option key={name} value={name}>{GROUP_ICON_LABELS[name]}</option>)}
      </select>
    </label>
  )
}

function moveTo<T>(list: readonly T[], from: number, to: number) {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

/**
 * Round I (I2): the admin list of community categories. Up and down buttons (keyboard and screen readers) and drag
 * and drop (saved through PUT /api/admin/community-categories) set the order; each row edits, hides or shows,
 * moves its communities or deletes its category.
 */
export function CategoryAdminList({ categories }: { categories: CommunityCategoryRecord[] }) {
  const router = useRouter()
  const [order, setOrder] = useState(categories)
  const [synced, setSynced] = useState(categories)
  const [dragging, setDragging] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [saving, startSaving] = useTransition()
  // A refreshed list from the server (after any change) replaces the local order.
  if (synced !== categories) {
    setSynced(categories)
    setOrder(categories)
  }

  function onDrop(event: DragEvent<HTMLLIElement>, target: number) {
    event.preventDefault()
    if (dragging === null || dragging === target) return
    const previous = order
    const next = moveTo(order, dragging, target)
    setOrder(next)
    setDragging(null)
    startSaving(async () => {
      const response = await fetch('/api/admin/community-categories', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order: next.map((category) => category.id) }),
      }).catch(() => null)
      if (!response?.ok) {
        setOrder(previous)
        setStatus('The new order could not be saved. Please try again.')
        return
      }
      setStatus(`Order saved: ${next.map((category) => category.name).join(', ')}.`)
      router.refresh()
    })
  }

  if (!order.length) return <p className="p-4 text-sm text-muted">No categories yet. Add the first one below.</p>

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">{saving ? 'Saving the new order…' : status}</p>
      {status && !saving ? <p className="px-4 pt-3 text-sm text-muted" aria-hidden="true">{status}</p> : null}
      <ol aria-label="Community categories, in directory order" className="divide-y divide-mist-100">
        {order.map((category, index) => {
          const others = order.filter((other) => other.id !== category.id)
          return (
            <li
              key={category.id}
              draggable
              onDragStart={() => setDragging(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDrop(event, index)}
              onDragEnd={() => setDragging(null)}
              className={`grid gap-3 p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start ${dragging === index ? 'opacity-60' : ''}`}
              data-category-slug={category.slug}
            >
              <span aria-hidden="true" className="hidden cursor-grab text-muted md:block" title="Drag to reorder"><GripVertical className="size-5" /></span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-lg bg-mist-50 text-ocean-700"><GroupIcon icon={category.icon} aria-hidden="true" className="size-4" /></span>
                  <span className="font-semibold text-navy-950">{index + 1}. {category.name}</span>
                  {category.hidden ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">Hidden</span> : null}
                </p>
                <p className="mt-1 text-xs text-muted">
                  /{category.slug} · {category.communityCount} {category.communityCount === 1 ? 'community' : 'communities'}
                  {category.description ? ` · ${category.description}` : ''}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-ocean-700">Edit {category.name}</summary>
                  <form action={updateCommunityCategory} className="mt-2 grid gap-3 md:grid-cols-2">
                    <input type="hidden" name="categoryId" value={category.id} />
                    <label className="block text-sm font-semibold text-navy-950">
                      Name
                      <input name="name" required maxLength={COMMUNITY_CATEGORY_NAME_MAX_LENGTH} defaultValue={category.name} className={`${inputClass} mt-1`} />
                    </label>
                    <CategoryIconSelect id={`category-icon-${category.id}`} defaultValue={category.icon} />
                    <label className="block text-sm font-semibold text-navy-950 md:col-span-2">
                      Short description (optional)
                      <input name="description" maxLength={COMMUNITY_CATEGORY_DESCRIPTION_MAX_LENGTH} defaultValue={category.description ?? ''} className={`${inputClass} mt-1`} />
                    </label>
                    <div className="md:col-span-2"><button type="submit" className={smallButton}>Save</button></div>
                  </form>
                </details>
                {category.communityCount > 0 && others.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-semibold text-ocean-700">Move its communities to…</summary>
                    <form action={moveCommunityCategoryCommunities} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="categoryId" value={category.id} />
                      <label className="block min-w-48 flex-1 text-sm font-semibold text-navy-950">
                        Move {category.communityCount} {category.communityCount === 1 ? 'community' : 'communities'} to
                        <select name="targetId" required defaultValue="" className={`${inputClass} mt-1`}>
                          <option value="" disabled>Choose a category</option>
                          {others.map((other) => <option key={other.id} value={other.id}>{other.hidden ? `${other.name} (hidden)` : other.name}</option>)}
                        </select>
                      </label>
                      <button type="submit" className={smallButton}>Move</button>
                      <button type="submit" name="thenDelete" value="true" className={dangerButton}>Move and delete {category.name}</button>
                    </form>
                  </details>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <form action={moveCommunityCategory}>
                  <input type="hidden" name="categoryId" value={category.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button type="submit" disabled={index === 0} aria-label={`Move ${category.name} up`} className={smallButton}><ArrowUp aria-hidden="true" className="size-4" /> Up</button>
                </form>
                <form action={moveCommunityCategory}>
                  <input type="hidden" name="categoryId" value={category.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button type="submit" disabled={index === order.length - 1} aria-label={`Move ${category.name} down`} className={smallButton}><ArrowDown aria-hidden="true" className="size-4" /> Down</button>
                </form>
                <form action={setCommunityCategoryHidden}>
                  <input type="hidden" name="categoryId" value={category.id} />
                  <input type="hidden" name="hidden" value={category.hidden ? 'false' : 'true'} />
                  <button type="submit" aria-label={`${category.hidden ? 'Show' : 'Hide'} ${category.name}`} className={smallButton}>
                    {category.hidden ? <Eye aria-hidden="true" className="size-4" /> : <EyeOff aria-hidden="true" className="size-4" />}
                    {category.hidden ? 'Show' : 'Hide'}
                  </button>
                </form>
                {category.communityCount === 0 ? (
                  <details className="relative">
                    <summary className={`${dangerButton} cursor-pointer list-none`}>Delete…</summary>
                    <form action={deleteCommunityCategory} className="mt-2">
                      <input type="hidden" name="categoryId" value={category.id} />
                      <button type="submit" className={dangerButton}>Delete {category.name} for good</button>
                    </form>
                  </details>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </>
  )
}
