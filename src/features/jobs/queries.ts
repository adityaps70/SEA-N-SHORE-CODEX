import { requireAwsUser, type AwsVerifiedUser } from '@/features/auth/aws-queries'
import { rankingSwitches } from '@/features/ranking/switches'
import { compareRankedJobs } from '@/features/ranking/job-scorer'
import { scoreJobForMember } from '@/features/ranking/job-match'
import { JOB_WEIGHTS } from '@/features/ranking/job-weights'
import { jobPoolOptions } from '@/features/ranking/job-pool'
import { scoreJobMatch } from './matching'
import { jobsRepository, type JobsRepository } from './repository'
import { parseJobSearchParams } from './search'
import type { JobCandidateProfile, JobListing, JobMatchResult } from './types'

type RequireUser = () => Promise<AwsVerifiedUser>
type RawJobSearchParams = Record<string, string | string[] | undefined>
type RankingSwitch = { isEnabled(area: 'jobs', profileId: string): Promise<boolean> }

export type JobDiscoveryItem = {
  job: JobListing
  isSaved: boolean
  alreadyApplied: boolean
  /** What the member sees: matching v2 (bands, eligibility) when the jobs switch is on, else round 12. */
  match: JobMatchResult | null
  /** The round-12 match the Apply button's minimum-match gate is enforced with (same as the server). */
  gateMatch?: JobMatchResult | null
}

const PAGE_SIZE = JOB_WEIGHTS.pool.pageSize

/**
 * Round H (H2): For You is the default list with no search words. It leaves out jobs the member is
 * not eligible for ("Not eligible: this role is for seafarers", below the employer's minimum match).
 * A search, or any other tab, still shows them with the label.
 */
export function isForYouList(filters: { mode: string; query: string }) {
  return filters.mode === 'for-you' && !filters.query.trim()
}

function pageNumber(raw: string | string[] | undefined) {
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : 1
}

export function createJobsQueries(input: { requireUser: RequireUser; repository: JobsRepository; ranking?: RankingSwitch }) {
  const ranking: RankingSwitch = input.ranking ?? rankingSwitches

  /** Matching v2 for display and ordering, with the round-12 match kept for the apply gate. */
  function matchesFor(job: JobListing, profile: JobCandidateProfile | null, v2: boolean) {
    if (!profile) return { match: null, gateMatch: null }
    if (v2) return scoreJobForMember(job, profile)
    const gateMatch = scoreJobMatch(job, profile)
    return { match: gateMatch, gateMatch }
  }
  async function getPublishedJobs() {
    await input.requireUser()
    return input.repository.listPublishedJobs(50)
  }

  async function getPublishedJob(id: string) {
    await input.requireUser()
    return input.repository.getPublishedJob(id)
  }

  async function getJobsDiscovery(rawParams: RawJobSearchParams) {
    const user = await input.requireUser()
    const filters = parseJobSearchParams(rawParams)
    if (await ranking.isEnabled('jobs', user.id).catch(() => false)) return getJobsDiscoveryV2(user.id, filters, pageNumber(rawParams.page))
    const [jobs, profile] = await Promise.all([
      input.repository.searchJobs(filters, 60, 0),
      input.repository.getCandidateProfile(user.id),
    ])
    const jobIds = jobs.map((job) => job.id)
    const [savedIdsRaw, appliedIdsRaw] = await Promise.all([
      input.repository.getSavedJobIds(user.id, jobIds),
      input.repository.getAppliedJobIds(user.id, jobIds),
    ])
    const savedIds = new Set(savedIdsRaw)
    const appliedIds = new Set(appliedIdsRaw)
    const forYou = isForYouList(filters)
    const items: JobDiscoveryItem[] = jobs
      .filter((job) => !(forYou && profile && scoreJobForMember(job, profile).match.eligible === false))
      .map((job) => ({
        job,
        isSaved: savedIds.has(job.id),
        alreadyApplied: appliedIds.has(job.id),
        ...matchesFor(job, profile, false),
      }))

    // "Best match" and For You order by the match score, jobs without a score (null) last.
    if (filters.sort === 'recommended' || filters.sort === 'best' || filters.mode === 'for-you') {
      items.sort((a, b) => {
        const scoreDelta = (b.match?.score ?? -1) - (a.match?.score ?? -1)
        if (scoreDelta !== 0) return scoreDelta
        const aDate = Date.parse(a.job.publishedAt ?? a.job.createdAt)
        const bDate = Date.parse(b.job.publishedAt ?? b.job.createdAt)
        return bDate - aDate
      })
    }

    return { filters, items, profileReady: Boolean(profile), version: 1 as const, page: 1, hasMore: false, applied: [] as JobDiscoveryItem[] }
  }

  /**
   * Round G (G3), behind ranking_settings.jobs. Recommended / Best match / For you: the SQL
   * prefilter pool (up to 300), scored with matching v2, eligible first then match × freshness,
   * applied jobs moved to an "Applied" section, "Not interested" jobs left out, 20 per page.
   * Other sorts page in SQL. Search never hides a job for eligibility; it only orders it lower.
   * Round H (H2): For You (no search words) leaves ineligible jobs out.
   */
  async function getJobsDiscoveryV2(userId: string, filters: ReturnType<typeof parseJobSearchParams>, page: number) {
    const profile = await input.repository.getCandidateProfile(userId)
    const ranked = filters.sort === 'recommended' || filters.sort === 'best' || filters.mode === 'for-you'
    const jobs = ranked
      ? await input.repository.searchJobs(filters, JOB_WEIGHTS.pool.maxScored, 0, jobPoolOptions(userId, profile))
      : await input.repository.searchJobs(filters, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE)
    const jobIds = jobs.map((job) => job.id)
    const [savedIdsRaw, appliedIdsRaw] = await Promise.all([
      input.repository.getSavedJobIds(userId, jobIds),
      input.repository.getAppliedJobIds(userId, jobIds),
    ])
    const savedIds = new Set(savedIdsRaw)
    const appliedIds = new Set(appliedIdsRaw)
    const all: JobDiscoveryItem[] = jobs.map((job) => ({
      job,
      isSaved: savedIds.has(job.id),
      alreadyApplied: appliedIds.has(job.id),
      ...matchesFor(job, profile, true),
    }))
    const base = { filters, profileReady: Boolean(profile), version: 2 as const, page }
    if (!ranked) {
      return { ...base, items: all.slice(0, PAGE_SIZE), hasMore: all.length > PAGE_SIZE, applied: [] as JobDiscoveryItem[] }
    }
    const now = new Date()
    const forYou = isForYouList(filters)
    const open = all
      .filter((item) => !item.alreadyApplied && !(forYou && item.match?.eligible === false))
      .sort((left, right) => compareRankedJobs(left, right, now))
    const start = (page - 1) * PAGE_SIZE
    return {
      ...base,
      items: open.slice(start, start + PAGE_SIZE),
      hasMore: open.length > start + PAGE_SIZE,
      applied: page === 1 ? all.filter((item) => item.alreadyApplied) : [],
    }
  }

  async function getMyJobApplications() {
    const user = await input.requireUser()
    return input.repository.listApplications(user.id)
  }

  async function getJobDetailState(id: string) {
    const user = await input.requireUser()
    const [job, alreadyApplied, isSaved, profile, v2] = await Promise.all([
      input.repository.getPublishedJob(id),
      input.repository.hasApplied(id, user.id),
      input.repository.isJobSaved(id, user.id),
      input.repository.getCandidateProfile(user.id),
      ranking.isEnabled('jobs', user.id).catch(() => false),
    ])
    const matches = job ? matchesFor(job, profile, v2) : { match: null, gateMatch: null }
    return {
      job,
      alreadyApplied,
      isSaved,
      match: matches.match,
      gateMatch: matches.gateMatch,
      profileReady: Boolean(profile),
    }
  }

  async function getJobApplicationState(id: string) {
    const state = await getJobDetailState(id)
    return { job: state.job, alreadyApplied: state.alreadyApplied }
  }

  async function getSavedJobs() {
    const user = await input.requireUser()
    return input.repository.listSavedJobs(user.id, 100)
  }

  async function getJobAlerts() {
    const user = await input.requireUser()
    return input.repository.listJobAlerts(user.id)
  }

  return {
    getPublishedJobs,
    getPublishedJob,
    getJobsDiscovery,
    getMyJobApplications,
    getJobDetailState,
    getJobApplicationState,
    getSavedJobs,
    getJobAlerts,
  }
}

const productionQueries = createJobsQueries({ requireUser: requireAwsUser, repository: jobsRepository })

export const getPublishedJobs = productionQueries.getPublishedJobs
export const getPublishedJob = productionQueries.getPublishedJob
export const getJobsDiscovery = productionQueries.getJobsDiscovery
export const getMyJobApplications = productionQueries.getMyJobApplications
export const getJobDetailState = productionQueries.getJobDetailState
export const getJobApplicationState = productionQueries.getJobApplicationState
export const getSavedJobs = productionQueries.getSavedJobs
export const getJobAlerts = productionQueries.getJobAlerts
