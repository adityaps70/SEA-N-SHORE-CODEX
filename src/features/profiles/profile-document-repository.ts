import type { QueryResultRow } from 'pg'
import { HIRING_ROLES } from '@/features/jobs/hiring-repository'
import { query as databaseQuery } from '@/lib/db/client'
import type { Persona } from './persona'
import type { ProfileDocumentKind, ProfileDocumentSummary } from './profile-document-policy'

type DocumentQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type EligibilityRow = QueryResultRow & {
  persona: string | null
  profile_type: string | null
  onboarding_completed_at: string | null
}

type DocumentRow = QueryResultRow & {
  kind: ProfileDocumentKind
  storage_path: string
  file_name: string
  size_bytes: number | string
  uploaded_at: string | Date
}

type AccessRow = QueryResultRow & { is_admin: boolean | null; is_employer: boolean | null }

export type ProfileDocumentRecord = ProfileDocumentSummary & { storagePath: string }

export type ProfileDocumentOwner = {
  persona: Persona | null
  profileType: string | null
  onboardingCompleted: boolean
}

export type ProfileDocumentViewerAccess = {
  isAdmin: boolean
  isEmployer: boolean
}

function toIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : String(value)
}

function mapDocument(row: DocumentRow): ProfileDocumentRecord {
  return {
    kind: row.kind,
    storagePath: row.storage_path,
    fileName: row.file_name,
    sizeBytes: Number(row.size_bytes),
    uploadedAt: toIso(row.uploaded_at),
  }
}

export function createProfileDocumentRepository(input: { query?: DocumentQuery } = {}) {
  const queryRows: DocumentQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  async function getOwner(profileId: string): Promise<ProfileDocumentOwner | null> {
    const rows = await queryRows(
      `select persona, profile_type::text as profile_type, onboarding_completed_at
       from public.profiles
       where id = $1
         and account_status = 'active'
       limit 1`,
      [profileId],
    ) as EligibilityRow[]
    const row = rows[0]
    if (!row) return null
    return {
      persona: (row.persona as Persona | null) ?? null,
      profileType: row.profile_type ?? null,
      onboardingCompleted: row.onboarding_completed_at !== null,
    }
  }

  async function getDocument(profileId: string, kind: ProfileDocumentKind): Promise<ProfileDocumentRecord | null> {
    const rows = await queryRows(
      `select kind, storage_path, file_name, size_bytes, uploaded_at
       from public.profile_documents
       where profile_id = $1
         and kind = $2
       limit 1`,
      [profileId, kind],
    ) as DocumentRow[]
    return rows[0] ? mapDocument(rows[0]) : null
  }

  /** Saves the new file reference and returns the one it replaced (to delete from storage). */
  async function upsertDocument(
    profileId: string,
    document: { kind: ProfileDocumentKind; storagePath: string; fileName: string; mimeType: string; sizeBytes: number },
  ): Promise<{ document: ProfileDocumentRecord; previousStoragePath: string | null }> {
    const rows = await queryRows(
      `with previous as (
         select storage_path
         from public.profile_documents
         where profile_id = $1
           and kind = $2
       )
       insert into public.profile_documents (profile_id, kind, storage_path, file_name, mime_type, size_bytes)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (profile_id, kind) do update set
         storage_path = excluded.storage_path,
         file_name = excluded.file_name,
         mime_type = excluded.mime_type,
         size_bytes = excluded.size_bytes,
         uploaded_at = now(),
         updated_at = now()
       returning kind, storage_path, file_name, size_bytes, uploaded_at,
         (select storage_path from previous) as previous_storage_path`,
      [profileId, document.kind, document.storagePath, document.fileName, document.mimeType, document.sizeBytes],
    ) as Array<DocumentRow & { previous_storage_path: string | null }>
    const row = rows[0]
    if (!row) throw new Error('profile_document_save_failed')
    const previous = row.previous_storage_path
    return {
      document: mapDocument(row),
      previousStoragePath: previous && previous !== row.storage_path ? previous : null,
    }
  }

  async function deleteDocument(profileId: string, kind: ProfileDocumentKind): Promise<string | null> {
    const rows = await queryRows(
      `delete from public.profile_documents
       where profile_id = $1
         and kind = $2
       returning storage_path`,
      [profileId, kind],
    ) as Array<QueryResultRow & { storage_path: string }>
    return rows[0]?.storage_path ?? null
  }

  /**
   * Why `viewerId` may open `ownerId`'s private documents: a platform
   * administrator, or a hiring reviewer for a job the owner applied to (and
   * has not withdrawn from). Mirrors the hiring applicant-review rule.
   */
  async function getViewerAccess(viewerId: string, ownerId: string): Promise<ProfileDocumentViewerAccess> {
    const rows = await queryRows(
      `select
         exists (
           select 1
           from public.user_roles ur
           where ur.user_id = $1
             and ur.role::text = 'administrator'
         ) as is_admin,
         exists (
           select 1
           from public.job_applications a
           join public.jobs j on j.id = a.job_id
           left join public.company_members cm
             on cm.company_id = j.company_id and cm.user_id = $1
           left join public.companies c on c.id = j.company_id
           where a.applicant_id = $2
             and a.status::text <> 'withdrawn'
             and (
               (j.company_id is null and j.created_by_user_id = $1)
               or (
                 j.company_id is not null
                 and cm.role::text = any($3::text[])
                 and cm.approved_at is not null
                 and c.is_verified = true
               )
             )
         ) as is_employer`,
      [viewerId, ownerId, [...HIRING_ROLES]],
    ) as AccessRow[]
    const row = rows[0]
    return { isAdmin: row?.is_admin === true, isEmployer: row?.is_employer === true }
  }

  return { getOwner, getDocument, upsertDocument, deleteDocument, getViewerAccess }
}

export type ProfileDocumentRepository = ReturnType<typeof createProfileDocumentRepository>

export const profileDocumentRepository = createProfileDocumentRepository()
