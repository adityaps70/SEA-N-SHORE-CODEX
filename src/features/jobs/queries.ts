import { requireAwsUser, type AwsVerifiedUser } from '@/features/auth/aws-queries'
import { jobsRepository, type JobsRepository } from './repository'

type RequireUser = () => Promise<AwsVerifiedUser>

export function createJobsQueries(input: { requireUser: RequireUser; repository: JobsRepository }) {
  async function getPublishedJobs() {
    await input.requireUser()
    return input.repository.listPublishedJobs(50)
  }

  async function getPublishedJob(id: string) {
    await input.requireUser()
    return input.repository.getPublishedJob(id)
  }

  async function getMyJobApplications() {
    const user = await input.requireUser()
    return input.repository.listApplications(user.id)
  }

  async function getJobApplicationState(id: string) {
    const user = await input.requireUser()
    const [job, alreadyApplied] = await Promise.all([
      input.repository.getPublishedJob(id),
      input.repository.hasApplied(id, user.id),
    ])
    return { job, alreadyApplied }
  }

  return { getPublishedJobs, getPublishedJob, getMyJobApplications, getJobApplicationState }
}

const productionQueries = createJobsQueries({ requireUser: requireAwsUser, repository: jobsRepository })

export const getPublishedJobs = productionQueries.getPublishedJobs
export const getPublishedJob = productionQueries.getPublishedJob
export const getMyJobApplications = productionQueries.getMyJobApplications
export const getJobApplicationState = productionQueries.getJobApplicationState
