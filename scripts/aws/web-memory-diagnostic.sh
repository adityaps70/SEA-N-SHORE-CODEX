#!/usr/bin/env bash
# Round 13 read-only diagnosis of the recurring web 502s: live ECS/autoscaling settings, web memory
# around each clock-hour boundary, ALB 5xx timing, task stops and service events. It only reads
# (describe/list/get-metric-data/filter-log-events) and never prints secrets or environment values.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER="sea-n-shore-staging"
SERVICE="sea-n-shore-staging-web"
ALB_NAME="sea-n-shore-staging-alb"
LOG_GROUP="/ecs/sea-n-shore-staging/web"
HOURS="${WEB_MEMORY_DIAGNOSTIC_HOURS:-72}"

[[ "${WEB_MEMORY_DIAGNOSTIC_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "WEB_MEMORY_DIAGNOSTIC_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$WEB_MEMORY_DIAGNOSTIC_EXPECTED_SHA" ]]
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]
[[ "$HOURS" =~ ^[0-9]+$ && "$HOURS" -ge 6 && "$HOURS" -le 336 ]]

WORK_DIR="$(mktemp -d /tmp/sea-n-shore-web-memory.XXXXXXXX)"
trap 'rm -rf -- "$WORK_DIR"' EXIT

echo "== Live service =="
aws ecs describe-services --region "$AWS_REGION" --cluster "$CLUSTER" --services "$SERVICE" --output json > "$WORK_DIR/service.json"
jq -r '.services[0] | "SERVICE_DESIRED=\(.desiredCount) SERVICE_RUNNING=\(.runningCount) SERVICE_PENDING=\(.pendingCount)",
  "SERVICE_TASK_DEFINITION=\(.taskDefinition | split("/") | last)",
  "SERVICE_DEPLOYMENT_MIN_HEALTHY=\(.deploymentConfiguration.minimumHealthyPercent) SERVICE_DEPLOYMENT_MAX=\(.deploymentConfiguration.maximumPercent) CIRCUIT_BREAKER=\(.deploymentConfiguration.deploymentCircuitBreaker // {} | tojson)",
  "SERVICE_SUBNETS=\(.networkConfiguration.awsvpcConfiguration.subnets | length) HEALTH_CHECK_GRACE=\(.healthCheckGracePeriodSeconds // 0) EXECUTE_COMMAND=\(.enableExecuteCommand)",
  "SERVICE_DEPLOYMENTS=\([.deployments[] | {status, rolloutState, desiredCount, runningCount, taskDefinition: (.taskDefinition | split("/") | last)}] | tojson)"' "$WORK_DIR/service.json"
TASK_DEF="$(jq -r '.services[0].taskDefinition' "$WORK_DIR/service.json")"
aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$TASK_DEF" --query taskDefinition --output json > "$WORK_DIR/task.json"
jq -r '"TASK_CPU=\(.cpu) TASK_MEMORY=\(.memory) EPHEMERAL_GIB=\(.ephemeralStorage.sizeInGiB // 20)",
  (.containerDefinitions[] | "CONTAINER=\(.name) COMMAND=\(.command // [] | tojson) ENTRYPOINT=\(.entryPoint // [] | tojson) MEMORY=\(.memory // "unset") MEMORY_RESERVATION=\(.memoryReservation // "unset") HEALTHCHECK=\(.healthCheck.command // [] | tojson)")' "$WORK_DIR/task.json"
aws ecs describe-clusters --region "$AWS_REGION" --clusters "$CLUSTER" --include SETTINGS --query 'clusters[0].settings' --output json | jq -r '"CLUSTER_SETTINGS=\(tojson)"'

echo "== Autoscaling =="
aws application-autoscaling describe-scalable-targets --region "$AWS_REGION" --service-namespace ecs \
  --resource-ids "service/$CLUSTER/$SERVICE" --output json \
  | jq -r '.ScalableTargets[] | "SCALABLE_TARGET_MIN=\(.MinCapacity) SCALABLE_TARGET_MAX=\(.MaxCapacity) SUSPENDED=\(.SuspendedState | tojson)"'
aws application-autoscaling describe-scaling-policies --region "$AWS_REGION" --service-namespace ecs \
  --resource-id "service/$CLUSTER/$SERVICE" --output json \
  | jq -r '.ScalingPolicies[] | "SCALING_POLICY=\(.PolicyName) TYPE=\(.PolicyType) METRIC=\(.TargetTrackingScalingPolicyConfiguration.PredefinedMetricSpecification.PredefinedMetricType // "custom") TARGET=\(.TargetTrackingScalingPolicyConfiguration.TargetValue // "n/a")"'
aws application-autoscaling describe-scaling-activities --region "$AWS_REGION" --service-namespace ecs \
  --resource-id "service/$CLUSTER/$SERVICE" --max-items 20 --output json \
  | jq -r '.ScalingActivities[] | "SCALING_ACTIVITY=\(.StartTime) \(.StatusCode) \(.Description)"'

echo "== ALB target group =="
ALB_ARN="$(aws elbv2 describe-load-balancers --region "$AWS_REGION" --names "$ALB_NAME" --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
ALB_DIMENSION="${ALB_ARN#*:loadbalancer/}"
aws elbv2 describe-target-groups --region "$AWS_REGION" --load-balancer-arn "$ALB_ARN" --output json > "$WORK_DIR/tg.json"
jq -r '.TargetGroups[] | "TARGET_GROUP=\(.TargetGroupName) HEALTH_PATH=\(.HealthCheckPath) INTERVAL=\(.HealthCheckIntervalSeconds) TIMEOUT=\(.HealthCheckTimeoutSeconds) HEALTHY=\(.HealthyThresholdCount) UNHEALTHY=\(.UnhealthyThresholdCount)"' "$WORK_DIR/tg.json"
for tg in $(jq -r '.TargetGroups[].TargetGroupArn' "$WORK_DIR/tg.json"); do
  aws elbv2 describe-target-group-attributes --region "$AWS_REGION" --target-group-arn "$tg" --output json \
    | jq -r '[.Attributes[] | select(.Key == "deregistration_delay.timeout_seconds" or .Key == "slow_start.duration_seconds") | "\(.Key)=\(.Value)"] | "TARGET_GROUP_ATTRIBUTES=" + join(" ")'
done
aws elbv2 describe-load-balancer-attributes --region "$AWS_REGION" --load-balancer-arn "$ALB_ARN" --output json \
  | jq -r '[.Attributes[] | select(.Key == "idle_timeout.timeout_seconds") | "\(.Key)=\(.Value)"] | "ALB_ATTRIBUTES=" + join(" ")'

echo "== Recent stops and service events =="
STOPPED="$(aws ecs list-tasks --region "$AWS_REGION" --cluster "$CLUSTER" --service-name "$SERVICE" --desired-status STOPPED --query taskArns --output json)"
if [[ "$(jq 'length' <<<"$STOPPED")" -gt 0 ]]; then
  aws ecs describe-tasks --region "$AWS_REGION" --cluster "$CLUSTER" --tasks $(jq -r '.[]' <<<"$STOPPED") --output json \
    | jq -r '.tasks[] | "STOPPED_TASK=\(.stoppedAt) CODE=\(.stopCode) REASON=\(.stoppedReason) EXIT=\([.containers[] | "\(.name):\(.exitCode // "n/a"):\(.reason // "")"] | join(","))"'
else
  echo "STOPPED_TASK=none-retained"
fi
jq -r '.services[0].events[:40][] | "SERVICE_EVENT=\(.createdAt) \(.message)"' "$WORK_DIR/service.json"

echo "== Metrics (last ${HOURS}h) =="
END="$(date -u +%Y-%m-%dT%H:%M:00Z)"
START="$(date -u -d "-${HOURS} hours" +%Y-%m-%dT%H:%M:00Z)"
python3 - "$CLUSTER" "$SERVICE" "$ALB_DIMENSION" > "$WORK_DIR/queries.json" <<'PY'
import json, sys
cluster, service, alb = sys.argv[1:]
def q(id, ns, name, dims, stat, period=60):
    return {"Id": id, "MetricStat": {"Metric": {"Namespace": ns, "MetricName": name,
            "Dimensions": [{"Name": k, "Value": v} for k, v in dims]}, "Period": period, "Stat": stat}, "ReturnData": True}
svc = [("ClusterName", cluster), ("ServiceName", service)]
lb = [("LoadBalancer", alb)]
print(json.dumps([
    q("mem_max", "AWS/ECS", "MemoryUtilization", svc, "Maximum"),
    q("cpu_max", "AWS/ECS", "CPUUtilization", svc, "Maximum"),
    q("ci_mem_mb", "ECS/ContainerInsights", "MemoryUtilized", svc, "Maximum"),
    q("ci_tasks", "ECS/ContainerInsights", "RunningTaskCount", svc, "Minimum"),
    q("ci_eph", "ECS/ContainerInsights", "EphemeralStorageUtilized", svc, "Maximum"),
    q("elb502", "AWS/ApplicationELB", "HTTPCode_ELB_502_Count", lb, "Sum"),
    q("elb503", "AWS/ApplicationELB", "HTTPCode_ELB_503_Count", lb, "Sum"),
    q("elb504", "AWS/ApplicationELB", "HTTPCode_ELB_504_Count", lb, "Sum"),
    q("target5xx", "AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", lb, "Sum"),
    q("conn_err", "AWS/ApplicationELB", "TargetConnectionErrorCount", lb, "Sum"),
    q("requests", "AWS/ApplicationELB", "RequestCount", lb, "Sum"),
    q("latency_p99", "AWS/ApplicationELB", "TargetResponseTime", lb, "p99"),
]))
PY
aws cloudwatch get-metric-data --region "$AWS_REGION" --start-time "$START" --end-time "$END" \
  --metric-data-queries "file://$WORK_DIR/queries.json" --output json > "$WORK_DIR/metrics.json"

python3 - "$WORK_DIR/metrics.json" <<'PY'
import json, sys
from collections import defaultdict
from datetime import datetime
data = json.load(open(sys.argv[1]))
series = {}
for r in data['MetricDataResults']:
    points = {}
    for ts, value in zip(r['Timestamps'], r['Values']):
        points[datetime.fromisoformat(ts.replace('Z', '+00:00')).replace(second=0, microsecond=0)] = value
    series[r['Id']] = points
    print(f"METRIC_POINTS {r['Id']}={len(points)}")

def hourly(id, agg):
    out = defaultdict(list)
    for ts, v in series.get(id, {}).items():
        out[ts.replace(minute=0)].append(v)
    return {h: agg(vs) for h, vs in out.items()}

mem = series.get('mem_max', {})
hours = sorted({ts.replace(minute=0) for ts in mem})
print('HOURLY hour_utc | mem_max% | mem_mb_max | cpu_max% | tasks_min | eph_gb_max | requests | elb502 | elb503 | elb504 | target5xx | conn_err | p99_s')
mx = {k: hourly(k, max) for k in ('mem_max', 'ci_mem_mb', 'cpu_max', 'ci_eph', 'latency_p99')}
mn = hourly('ci_tasks', min)
sm = {k: hourly(k, sum) for k in ('requests', 'elb502', 'elb503', 'elb504', 'target5xx', 'conn_err')}
def f(d, h, fmt='{:.0f}'):
    v = d.get(h)
    return '-' if v is None else fmt.format(v)
for h in hours:
    print('HOURLY ' + ' | '.join([
        h.strftime('%m-%d %H:00'), f(mx['mem_max'], h), f(mx['ci_mem_mb'], h), f(mx['cpu_max'], h), f(mn, h),
        f(mx['ci_eph'], h, '{:.1f}'), f(sm['requests'], h), f(sm['elb502'], h), f(sm['elb503'], h), f(sm['elb504'], h),
        f(sm['target5xx'], h), f(sm['conn_err'], h), f(mx['latency_p99'], h, '{:.2f}')]))

# Minute-of-hour profile: is memory (and are 502s) concentrated just after :00?
by_minute = defaultdict(list)
for ts, v in mem.items():
    by_minute[ts.minute].append(v)
profile = {m: sum(v) / len(v) for m, v in by_minute.items() if v}
if profile:
    print('MINUTE_OF_HOUR_MEM_AVG ' + ' '.join(f'{m:02d}:{profile[m]:.0f}' for m in sorted(profile)))
jumps = []
for h in hours:
    before = [mem[t] for t in mem if t.replace(minute=0) == h and 50 <= t.minute <= 59]
    nxt = [mem[t] for t in mem if t.replace(minute=0).timestamp() == h.timestamp() + 3600 and 0 <= t.minute <= 9]
    if before and nxt:
        jumps.append(max(nxt) - max(before))
if jumps:
    up = sum(1 for j in jumps if j >= 5)
    print(f'HOUR_BOUNDARY_JUMPS count={len(jumps)} up_5pts_or_more={up} mean_jump={sum(jumps)/len(jumps):.1f} max_jump={max(jumps):.0f}')
for key in ('elb502', 'conn_err'):
    minutes = defaultdict(float)
    for ts, v in series.get(key, {}).items():
        minutes[ts.minute] += v
    total = sum(minutes.values())
    early = sum(v for m, v in minutes.items() if m < 10)
    print(f'MINUTE_OF_HOUR_{key.upper()} total={total:.0f} first_10_minutes={early:.0f} ' + ' '.join(f'{m:02d}:{minutes[m]:.0f}' for m in sorted(minutes) if minutes[m]))
# Big drops in memory mark task restarts (OOM kill or replacement).
drops = []
ordered = sorted(mem.items())
for (t1, v1), (t2, v2) in zip(ordered, ordered[1:]):
    if v1 - v2 >= 25:
        drops.append(f'{t2:%m-%d %H:%M}({v1:.0f}->{v2:.0f})')
print('MEMORY_DROPS ' + (' '.join(drops) if drops else 'none'))
PY

echo "== Web logs (last ${HOURS}h) =="
START_MS="$(( $(date -u -d "$START" +%s) * 1000 ))"
for pattern in '"FATAL ERROR"' '"heap out of memory"' '"Killed"' '"_next/image"' '"ECONNRESET"' '"Error:"'; do
  COUNT="$(aws logs filter-log-events --region "$AWS_REGION" --log-group-name "$LOG_GROUP" --start-time "$START_MS" \
    --filter-pattern "$pattern" --max-items 20000 --query 'length(events)' --output text 2>/dev/null || echo error)"
  echo "WEB_LOG_COUNT pattern=$pattern count=$COUNT"
done
echo "WEB_MEMORY_DIAGNOSTIC_VERIFIED=true"
