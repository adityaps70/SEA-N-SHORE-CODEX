import { CreateJobCommand, GetJobCommand, MediaConvertClient } from '@aws-sdk/client-mediaconvert'
import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { DEFAULT_MONTHLY_TRANSCODE_MINUTES, runTranscodeSweep, type TranscodeJob } from './media-renditions'

type Environment = Record<string, string | undefined>

const ROLE_ARN = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_-]{1,64}$/

/**
 * Round P3 (Part D, option a): the outbox worker's transcode sweep. Off unless the worker task carries the
 * MediaConvert role (MEDIA_TRANSCODE_ROLE_ARN) and the media bucket, which media-cdn-infra.sh enable-once adds once
 * the role exists. MEDIA_TRANSCODE_MONTHLY_MINUTES lowers or raises the monthly cap.
 */
export function createMediaTranscodeSweep(environment: Environment = process.env) {
  const roleArn = environment.MEDIA_TRANSCODE_ROLE_ARN?.trim() ?? ''
  const bucket = environment.AWS_MEDIA_BUCKET?.trim() ?? ''
  if (!ROLE_ARN.test(roleArn) || !/^[a-z0-9.-]{3,63}$/.test(bucket)) return null
  const cap = Number(environment.MEDIA_TRANSCODE_MONTHLY_MINUTES ?? DEFAULT_MONTHLY_TRANSCODE_MINUTES)
  const client = new MediaConvertClient({ region: environment.AWS_REGION || 'ap-south-1' })
  return () => runTranscodeSweep({
    query: async (text, values) => (await databaseQuery<QueryResultRow>(text, values)) as QueryResultRow[],
    createJob: async (job: TranscodeJob) => {
      const result = await client.send(new CreateJobCommand(job))
      const jobId = result.Job?.Id
      if (!jobId) throw new Error('mediaconvert_job_missing')
      return { jobId }
    },
    getJob: async (jobId) => {
      const { Job: job } = await client.send(new GetJobCommand({ Id: jobId }))
      const durations = (job?.OutputGroupDetails ?? []).flatMap((group) => (group.OutputDetails ?? []).map((detail) => detail.DurationInMs ?? 0))
      return {
        status: job?.Status ?? 'UNKNOWN',
        errorCode: job?.ErrorCode ?? null,
        errorMessage: job?.ErrorMessage ?? null,
        durationMs: durations.length ? Math.max(...durations) : null,
      }
    },
    bucket,
    roleArn,
    monthlyMinuteCap: Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_MONTHLY_TRANSCODE_MINUTES,
    log: (line) => console.info(line),
  })
}
