'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState } from 'react'
import { ExternalLink } from 'lucide-react'
import { accessRoleLabel } from '@/features/organizations/access-request-labels'
import { organizationPageHref, type LinkedOrganization } from '../organization-link'
import type { ProfileOrganization } from '../organization-link-repository'
import { updateProfileCurrentOrganization, type ProfileInlineActionState } from '../profile-inline-actions'
import { OrganizationLogo } from './organization-logo'
import { OrganizationStatusBadge } from './organization-status-badge'
import { ProfileCardFieldError, ProfileCardForm, useProfileCardEditor } from './profile-card-editing'
import { ProfileSection, ProfileSectionEditButton, profileFieldLabelClass } from './profile-section'
import { PhoneShowAll } from './profile-show-all'

function OrganizationRow({ organization }: { organization: ProfileOrganization }) {
  const meta = [organization.type, organization.location].filter(Boolean).join(' · ')
  return (
    <Link
      href={organizationPageHref(organization.slug)}
      className="group flex min-w-0 items-center gap-3 rounded-2xl border border-mist-200 bg-white p-3 transition hover:border-ocean-200 hover:bg-ocean-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600"
    >
      <OrganizationLogo logoUrl={organization.logoUrl} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-sm font-semibold text-navy-950 group-hover:text-ocean-700 group-hover:underline">{organization.name}</span>
          <OrganizationStatusBadge organization={organization} size="sm" />
        </span>
        <span className="mt-0.5 block text-sm text-ink">{accessRoleLabel(organization.role)}</span>
        {meta ? <span className="block truncate text-xs text-muted">{meta}</span> : null}
      </span>
    </Link>
  )
}

function OrganizationGroup({ id, label, organizations }: { id: string; label: string; organizations: ProfileOrganization[] }) {
  if (!organizations.length) return null
  return (
    <div className="mt-5 first-of-type:mt-4">
      <h3 id={id} className={profileFieldLabelClass}>{label}</h3>
      <PhoneShowAll as="ul" itemAs="li" itemClassName="min-w-0" labelledBy={id} noun="organizations" placement="inline" className="mt-2 grid gap-2 sm:grid-cols-2">
        {organizations.map((organization) => <OrganizationRow key={organization.id} organization={organization} />)}
      </PhoneShowAll>
    </div>
  )
}

/** The organization the header shows, as saved on the profile. */
export type ProfileCurrentOrganizationValue = {
  name: string | null
  organization: LinkedOrganization | null
}

const initialState: ProfileInlineActionState = {}
const radioRowClass = 'flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 has-[:checked]:border-ocean-500 has-[:checked]:bg-ocean-50/50'

/**
 * Organizations' edit form: which organization is the current one shown in the header (one the
 * member belongs to, the one already saved, or none). Roles stay on each organization's own page;
 * owners and administrators get a link there. Leaving is done by the organization's administrators.
 */
function ProfileOrganizationsEditor({
  organizations,
  current,
  onClose,
  onSaved,
  onDirty,
}: {
  organizations: ProfileOrganization[]
  current: ProfileCurrentOrganizationValue
  onClose: () => void
  onSaved: () => void
  onDirty: () => void
}) {
  const router = useRouter()

  async function submit(previousState: ProfileInlineActionState, formData: FormData) {
    const nextState = await updateProfileCurrentOrganization(previousState, formData)
    if (nextState.success) {
      onSaved()
      router.refresh()
    }
    return nextState
  }

  const [state, formAction, pending] = useActionState(submit, initialState)
  const currentId = current.organization?.id ?? null
  const currentIsMembership = Boolean(currentId && organizations.some((organization) => organization.id === currentId))
  const savedName = current.organization?.name ?? current.name?.trim() ?? ''
  const keepOption = !currentIsMembership && Boolean(savedName)
  const defaultChoice = currentIsMembership ? currentId : keepOption ? 'keep' : 'none'

  return (
    <ProfileCardForm cardId="profile-organizations" label="Edit organizations" action={formAction} pending={pending} onCancel={onClose} onDirty={onDirty} error={state.error}>
      <fieldset>
        <legend className="text-sm font-semibold text-navy-950">Current organization</legend>
        <p className="mt-1 text-sm text-muted">The one shown under your name in your profile header and on your posts.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {organizations.map((organization) => {
            const manages = organization.role === 'owner' || organization.role === 'administrator'
            return (
              <div key={organization.id} className="min-w-0">
                <label className={radioRowClass}>
                  <input type="radio" name="currentOrganization" value={organization.id} defaultChecked={defaultChoice === organization.id} className="size-4 shrink-0 accent-ocean-700" />
                  <OrganizationLogo logoUrl={organization.logoUrl} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{organization.name}</span>
                    <span className="block text-xs text-muted">{accessRoleLabel(organization.role)}</span>
                  </span>
                </label>
                {manages ? (
                  <Link href={`${organizationPageHref(organization.slug)}/manage`} className="mt-1 inline-flex min-h-8 items-center gap-1 px-1 text-xs font-semibold text-ocean-700 hover:underline">
                    Manage on organization page
                    <ExternalLink aria-hidden="true" className="size-3" />
                  </Link>
                ) : null}
              </div>
            )
          })}
          {keepOption ? (
            <label className={radioRowClass}>
              <input type="radio" name="currentOrganization" value="keep" defaultChecked={defaultChoice === 'keep'} className="size-4 shrink-0 accent-ocean-700" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">Keep “{savedName}”</span>
                <span className="block text-xs text-muted">Saved on your profile, not one of your organizations here</span>
              </span>
            </label>
          ) : null}
          <label className={radioRowClass}>
            <input type="radio" name="currentOrganization" value="none" defaultChecked={defaultChoice === 'none'} className="size-4 shrink-0 accent-ocean-700" />
            <span className="font-semibold">Don’t show an organization</span>
          </label>
        </div>
        <ProfileCardFieldError fieldErrors={state.fieldErrors} name="currentOrganization" />
      </fieldset>
      <p className="mt-3 text-xs text-muted">
        Roles are changed on each organization’s own page. To leave an organization, ask one of its administrators to remove you from its team.
      </p>
    </ProfileCardForm>
  )
}

/**
 * The Organizations section of a profile: pages the member owns or manages, and
 * organizations they work for. Only approved memberships of organizations that
 * Sea N Shore lists, the same people each organization's People tab shows.
 * On the member's own profile its pencil chooses the current organization in place.
 */
export function ProfileOrganizations({
  organizations,
  editable = false,
  current = { name: null, organization: null },
  organisationAccount = false,
}: {
  organizations: ProfileOrganization[]
  /** The member's own profile: show an empty state and edit the current organization in place. */
  editable?: boolean
  /** The organization saved as the member's current one (shown in the header). */
  current?: ProfileCurrentOrganizationValue
  /** Organisation accounts do not show a current organization in their header. */
  organisationAccount?: boolean
}) {
  const editor = useProfileCardEditor('profile-organizations', 'Organizations')
  const canChooseCurrent = editable && !organisationAccount
    && (organizations.length > 0 || Boolean(current.organization || current.name?.trim()))
  const editing = canChooseCurrent && editor.editing

  if (!editable && !organizations.length) return null
  const manages = organizations.filter((organization) => organization.relation === 'manages')
  const worksAt = organizations.filter((organization) => organization.relation === 'works_at')

  return (
    <ProfileSection
      id="profile-organizations"
      title="Organizations"
      action={canChooseCurrent && !editing ? (
        <ProfileSectionEditButton label="Edit organizations" onClick={editor.open} buttonRef={editor.triggerRef} />
      ) : null}
    >
      {editing ? (
        <ProfileOrganizationsEditor
          organizations={organizations}
          current={current}
          onClose={editor.close}
          onDirty={editor.markDirty}
          onSaved={editor.close}
        />
      ) : organizations.length ? (
        <>
          <OrganizationGroup id="profile-organizations-manages" label="Owns or manages" organizations={manages} />
          <OrganizationGroup id="profile-organizations-works-at" label="Works at" organizations={worksAt} />
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">
          You are not part of an organization on Sea N Shore yet.{' '}
          <Link href="/organizations" className="font-semibold text-ocean-700 hover:underline">Find the one you work with</Link>
          {' '}and ask to join, or register the organization you run.
        </p>
      )}
    </ProfileSection>
  )
}
