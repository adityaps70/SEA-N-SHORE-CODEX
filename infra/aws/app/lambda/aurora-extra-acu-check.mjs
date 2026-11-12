// Round DB (owner-approved 12 Nov): Aurora Serverless v2 may now scale to 4 ACU instead of 2. This check emails the
// alerts topic once the month's capacity above 2 ACU passes the approved allowance (39 ACU-hours, about ₹700 at
// ₹17.8 per ACU-hour incl. GST). It runs hourly, reads only the cluster's ServerlessDatabaseCapacity metric, and sends
// one email in the hour the month-to-date total first passes the allowance. It reads no database and no member data.
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'

const HOUR = 3600_000
const DAY = 24 * HOUR
// CloudWatch keeps one-minute data for 15 days; older data in the month is read at five minutes with the Maximum of
// each five minutes, which can only overstate the extra (the email comes early, never late).
const FINE_DAYS = 14

/** ACU-hours above `base` in the points, each point covering `periodSeconds`. */
export function extraAcuHours(values, base, periodSeconds) {
  let total = 0
  for (const value of values) if (Number.isFinite(value) && value > base) total += ((value - base) * periodSeconds) / 3600
  return total
}

/** The month-to-date windows to read at the last full hour `end`: [start, end, period, stat]. */
export function monthWindows(end) {
  const monthStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
  const fineStart = new Date(Math.max(monthStart.getTime(), end.getTime() - FINE_DAYS * DAY))
  const windows = []
  if (fineStart > monthStart) windows.push([monthStart, fineStart, 300, 'Maximum'])
  if (end > fineStart) windows.push([fineStart, end, 60, 'Average'])
  return windows
}

export function lastFullHour(now) {
  return new Date(Math.floor(now.getTime() / HOUR) * HOUR)
}

/** [timestamp ms, value] points of the cluster's capacity metric. */
async function capacityPoints(cloudwatch, clusterId, start, end, period, stat) {
  const points = []
  let NextToken
  do {
    const result = await cloudwatch.send(new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      NextToken,
      ScanBy: 'TimestampAscending',
      MetricDataQueries: [{
        Id: 'capacity',
        ReturnData: true,
        MetricStat: {
          Metric: { Namespace: 'AWS/RDS', MetricName: 'ServerlessDatabaseCapacity', Dimensions: [{ Name: 'DBClusterIdentifier', Value: clusterId }] },
          Period: period,
          Stat: stat,
        },
      }],
    }))
    for (const r of result.MetricDataResults ?? []) {
      const times = r.Timestamps ?? []
      ;(r.Values ?? []).forEach((value, i) => points.push([new Date(times[i]).getTime(), value]))
    }
    NextToken = result.NextToken
  } while (NextToken)
  return points
}

/** Month-to-date extra ACU-hours at `end`, and the same total without the last hour (one read of the metric). */
export async function monthToDateExtra(cloudwatch, clusterId, base, end) {
  const lastHourStart = end.getTime() - HOUR
  let total = 0
  let lastHour = 0
  for (const [start, stop, period, stat] of monthWindows(end)) {
    for (const [time, value] of await capacityPoints(cloudwatch, clusterId, start, stop, period, stat)) {
      const extra = extraAcuHours([value], base, period)
      total += extra
      if (time >= lastHourStart) lastHour += extra
    }
  }
  return { total, previous: total - lastHour }
}

export function createHandler({ cloudwatch, sns, env, now = () => new Date() }) {
  const clusterId = env.AURORA_CLUSTER_ID
  const topicArn = env.ALERT_TOPIC_ARN
  const base = Number(env.BASE_ACU)
  const allowance = Number(env.ALLOWANCE_ACU_HOURS)
  const rupeesPerAcuHour = Number(env.RUPEES_PER_ACU_HOUR)
  if (!clusterId || !topicArn || !(base > 0) || !(allowance > 0) || !(rupeesPerAcuHour > 0)) throw new Error('aurora_extra_acu_check_misconfigured')

  return async function handler() {
    const end = lastFullHour(now())
    const { total, previous } = await monthToDateExtra(cloudwatch, clusterId, base, end)
    // One email, in the hour the month-to-date total first reaches the allowance.
    const crossed = total >= allowance && previous < allowance
    const rupees = (acuHours) => Math.round(acuHours * rupeesPerAcuHour)
    const summary = {
      month: end.toISOString().slice(0, 7),
      until: end.toISOString(),
      extraAcuHours: Number(total.toFixed(2)),
      allowanceAcuHours: allowance,
      estimatedRupees: rupees(total),
      crossed,
    }
    console.log(JSON.stringify(summary))
    if (crossed) {
      await sns.send(new PublishCommand({
        TopicArn: topicArn,
        Subject: `Aurora: this month's capacity above ${base} ACU passed about Rs ${rupees(allowance)}`,
        Message: [
          `Aurora Serverless (${clusterId}) has used ${summary.extraAcuHours} ACU-hours above ${base} ACU so far in ${summary.month},`,
          `about Rs ${summary.estimatedRupees} at Rs ${rupeesPerAcuHour} per ACU-hour including GST.`,
          `The approved allowance is ${allowance} ACU-hours (about Rs ${rupees(allowance)}) a month.`,
          `Counted until ${summary.until} from the ServerlessDatabaseCapacity metric. This email is sent once a month.`,
        ].join('\n'),
      }))
    }
    return summary
  }
}

let defaultHandler
export async function handler(event) {
  defaultHandler ??= createHandler({ cloudwatch: new CloudWatchClient({}), sns: new SNSClient({}), env: process.env })
  return defaultHandler(event)
}
