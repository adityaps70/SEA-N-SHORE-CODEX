import { requireAwsUser, type AwsVerifiedUser } from '@/features/auth/aws-queries'
import { scoreJobMatch } from './matching'
import { jobsRepository, type JobsRepository } from './repository'
import { parseJobSearchParams } from './search'

type RequireUser = () => Promise<AwsVerifiedUser>
type RawJobSearchParams = Record<string, string | string[] | undefined>

export function createJobsQueries(input: { requireUser: RequireUser; repository: JobsRepository }) {
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
    const [jobs, profile] = await Promise.all([
      input.repository.searchJobs(filters, 60, 0),
      input.repository.getCandidateProfile(user.id),
    ])
    const savedIds = new Set(await input.repository.getSavedJobIds(user.id, jobs.map((job) => job.id)))
    const items = jobs.map((job) => ({
      job,
      isSaved: savedIds.has(job.id),
      match: profile ? scoreJobMatch(job, profile) : null,
    }))

    if (filters.sort === 'recommended' || filters.mode === 'for-you') {
      items.sort((a, b) => {
        const scoreDelta = (b.match?.score ?? -1) - (a.match?.score ?? -1)
        if (scoreDelta !== 0) return scoreDelta
        const aDate = Date.parse(a.job.publishedAt ?? a.job.createdAt)
        const bDate = Date.parse(b.job.publishedAt ?? b.job.createdAt)
        return bDate - aDate
      })
    }

    return { filters, items, profileReady: Boolean(profile) }
  }

  async function getMyJobApplications() {
    const user = await input.requireUser()
    return input.repository.listApplications(user.id)
  }

  async function getJobDetailState(id: string) {
    const user = await input.requireUser()
    const [job, alreadyApplied, isSaved, profile] = await Promise.all([
      input.repository.getPublishedJob(id),
      input.repository.hasApplied(id, user.id),
      input.repository.isJobSaved(id, user.id),
      input.repository.getCandidateProfile(user.id),
    ])
    return {
      job,
      alreadyApplied,
      isSaved,
      match: job && profile ? scoreJobMatch(job, profile) : null,
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
