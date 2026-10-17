/**
 * Round H (H1): CloudWatch metrics without an SDK call or a new service. One JSON line in the
 * Embedded Metric Format on stdout; the awslogs driver ships it to CloudWatch Logs, which turns it
 * into metrics that the alarms in infra/aws/app/web-resilience.tf watch. Dimension values must be
 * short fixed labels: never a member's name, email, id or a full URL.
 */
export const METRIC_NAMESPACE = 'SeaNShore/App'

export type MetricUnit = 'Count' | 'Milliseconds' | 'None'

export function emfLine(input: {
  namespace?: string
  dimensions?: Record<string, string>
  metrics: Record<string, { value: number; unit?: MetricUnit }>
  /** Extra dimension sets; [] (no dimensions) gives the all-up total as well. */
  rollups?: string[][]
  timestamp?: number
}) {
  const dimensions = input.dimensions ?? {}
  const keys = Object.keys(dimensions)
  const dimensionSets = [keys, ...(input.rollups ?? [])]
  return JSON.stringify({
    _aws: {
      Timestamp: input.timestamp ?? Date.now(),
      CloudWatchMetrics: [{
        Namespace: input.namespace ?? METRIC_NAMESPACE,
        Dimensions: dimensionSets,
        Metrics: Object.entries(input.metrics).map(([name, metric]) => ({ Name: name, Unit: metric.unit ?? 'Count' })),
      }],
    },
    ...dimensions,
    ...Object.fromEntries(Object.entries(input.metrics).map(([name, metric]) => [name, metric.value])),
  })
}

export function emitMetric(input: Parameters<typeof emfLine>[0], write: (line: string) => void = (line) => console.log(line)) {
  try {
    write(emfLine(input))
  } catch {
    // Metrics must never break a request.
  }
}
