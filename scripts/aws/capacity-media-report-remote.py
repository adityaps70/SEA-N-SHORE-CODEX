#!/usr/bin/env python3
"""Round P3: read-only capacity and media report for the staging (production) stack.

Runs on the bootstrap host through SSM, one section per invocation (REPORT_SECTION = config, usage,
media) so each answer stays under the SSM output limit. Every AWS call is a describe, get or list
(the guard test enforces it); SQL runs through the RDS Data API inside a READ ONLY transaction that is
rolled back. Output is aggregate numbers and configuration only: no member names, emails, ids, IP
addresses, object keys or file contents. Paths are reduced to route shapes (/jobs/:x).
"""
import datetime as dt
import gzip
import json
import os
import re
import statistics
import subprocess
import tempfile
from collections import Counter, defaultdict

REGION = os.environ.get("AWS_REGION", "ap-south-1")
EDGE = "us-east-1"
PREFIX = "sea-n-shore-staging"
ACCOUNT = "310356785722"
CLUSTER_ID = PREFIX + "-aurora"
DAYS = int(os.environ.get("REPORT_DAYS", "14"))
SECTION = os.environ.get("REPORT_SECTION", "config")
NOW = dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0)
START = NOW - dt.timedelta(days=DAYS)
# The load test report covers only its own window (REPORT_START/REPORT_END, whole UTC minutes).
if os.environ.get("REPORT_START") and os.environ.get("REPORT_END"):
    START = dt.datetime.strptime(os.environ["REPORT_START"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    NOW = dt.datetime.strptime(os.environ["REPORT_END"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    assert START < NOW <= START + dt.timedelta(hours=6), "the report window must be under 6 hours"
COUNTS = Counter()


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def out(*parts):
    print(" ".join(str(p) for p in parts), flush=True)


def aws(service, action, *args, region=REGION, quiet=False):
    """One read-only AWS CLI call; None when it fails (the reason is printed, never the payload)."""
    try:
        p = subprocess.run(["aws", service, action, *[str(a) for a in args], "--region", region, "--output", "json"],
                           text=True, capture_output=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired) as exc:
        COUNTS["errors"] += 1
        out("ERROR", service, action, type(exc).__name__)
        return None
    if p.returncode != 0:
        COUNTS["errors"] += 1
        if not quiet:
            reason = re.sub(r"arn:aws:\S+", "[ARN]", p.stderr.strip().splitlines()[-1] if p.stderr.strip() else "failed")
            out("ERROR", service, action, reason[:200])
        return None
    COUNTS["calls"] += 1
    return json.loads(p.stdout) if p.stdout.strip() else {}


def mb(n):
    return round((n or 0) / 1048576, 2)


def pct(values, p):
    if not values:
        return None
    values = sorted(values)
    k = max(0, min(len(values) - 1, int(round(p / 100 * (len(values) - 1)))))
    return values[k]


# ---------------------------------------------------------------- CloudWatch helpers

def metric_series(namespace, name, dims, stat, period, region=REGION, start=None):
    q = {"Id": "m", "MetricStat": {"Metric": {"Namespace": namespace, "MetricName": name,
         "Dimensions": [{"Name": k, "Value": v} for k, v in dims.items()]}, "Period": period, "Stat": stat},
         "ReturnData": True}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump([q], f)
        path = f.name
    values = []
    try:
        data = aws("cloudwatch", "get-metric-data", "--start-time", iso(start or START), "--end-time", iso(NOW),
                   "--metric-data-queries", "file://" + path, "--scan-by", "TimestampAscending", region=region)
    finally:
        os.unlink(path)
    if data:
        for r in data.get("MetricDataResults", []):
            values.extend(r.get("Values", []))
    return values


def summarize(label, values, unit="", scale=1.0):
    if not values:
        out("METRIC", label, "NO_DATA")
        return
    v = [x * scale for x in values]
    out("METRIC", label, "avg=%s" % round(statistics.fmean(v), 3), "p95=%s" % round(pct(v, 95), 3),
        "max=%s" % round(max(v), 3), "samples=%d" % len(v), unit)


def search_dims(namespace, name, contains, region=REGION):
    """The dimension sets of a metric whose values contain a name (ALB and target group ids are AWS-made)."""
    data = aws("cloudwatch", "list-metrics", "--namespace", namespace, "--metric-name", name, region=region)
    found = []
    for m in (data or {}).get("Metrics", []):
        dims = {d["Name"]: d["Value"] for d in m.get("Dimensions", [])}
        if any(contains in v for v in dims.values()):
            found.append(dims)
    return found


# ---------------------------------------------------------------- DB through the Data API (read only)

def cluster():
    data = aws("rds", "describe-db-clusters", "--db-cluster-identifier", CLUSTER_ID)
    return (data or {}).get("DBClusters", [{}])[0]


EXPLAIN_PREFIX = "explain (generic_plan, costs, format json) "


def sql_rows(statements):
    """Runs SELECT/SHOW statements in one READ ONLY transaction, then rolls back. Yields rows per statement."""
    c = cluster()
    arn, secret = c.get("DBClusterArn"), (c.get("MasterUserSecret") or {}).get("SecretArn")
    if not arn or not secret:
        out("SQL UNAVAILABLE no Data API cluster or secret")
        return [None] * len(statements)
    base = ["--resource-arn", arn, "--secret-arn", secret, "--database", "sea_n_shore"]
    tx = aws("rds-data", "begin-transaction", *base)
    if not tx:
        return [None] * len(statements)
    txid = tx["transactionId"]
    results = []
    try:
        aws("rds-data", "execute-statement", *base, "--transaction-id", txid, "--sql", "SET TRANSACTION READ ONLY")
        # Round CAP (finding 2): no report statement may hold the database for long; this one transaction stops any
        # statement after 30 seconds.
        aws("rds-data", "execute-statement", *base, "--transaction-id", txid, "--sql", "SET LOCAL statement_timeout = '30s'")
        for statement in statements:
            # Round DB: EXPLAIN only with GENERIC_PLAN and without ANALYZE, so the statement is planned, never run.
            assert re.match(r"^\s*(select|show|with)\b", statement, re.I) or statement.startswith(EXPLAIN_PREFIX), "read-only statements only"
            r = aws("rds-data", "execute-statement", *base, "--transaction-id", txid, "--sql", statement,
                    "--format-records-as", "JSON")
            results.append(json.loads(r["formattedRecords"]) if r and r.get("formattedRecords") else None)
    finally:
        # Round DB: rollback-transaction takes no --database; passing it made every rollback fail quietly, so the
        # read-only transactions stayed open (idle in transaction) until the Data API timed them out.
        if aws("rds-data", "rollback-transaction", "--resource-arn", arn, "--secret-arn", secret, "--transaction-id", txid) is None:
            out("SQL ROLLBACK FAILED")
    return results


# ---------------------------------------------------------------- section: config

def section_config():
    out("=== A1 WHAT WE RUN ===")
    clusters = aws("ecs", "list-clusters") or {}
    ecs_cluster = next((a.split("/")[-1] for a in clusters.get("clusterArns", []) if PREFIX in a), None)
    out("ECS_CLUSTER", ecs_cluster)
    services = (aws("ecs", "list-services", "--cluster", ecs_cluster) or {}).get("serviceArns", []) if ecs_cluster else []
    names = [s.split("/")[-1] for s in services]
    described = (aws("ecs", "describe-services", "--cluster", ecs_cluster, "--services", *names) or {}).get("services", []) if names else []
    subnets_az = {}
    for s in described:
        td = (aws("ecs", "describe-task-definition", "--task-definition", s["taskDefinition"]) or {}).get("taskDefinition", {})
        subnets = (((s.get("networkConfiguration") or {}).get("awsvpcConfiguration") or {}).get("subnets") or [])
        azs = set()
        for sn in subnets:
            if sn not in subnets_az:
                d = aws("ec2", "describe-subnets", "--subnet-ids", sn) or {}
                subnets_az[sn] = (d.get("Subnets") or [{}])[0].get("AvailabilityZone")
            azs.add(subnets_az[sn])
        env = {}
        for c in td.get("containerDefinitions", []):
            for e in c.get("environment", []):
                if e["name"] in ("NODE_OPTIONS", "UV_THREADPOOL_SIZE", "PORT", "HOSTNAME", "NODE_ENV",
                                 "DATABASE_POOL_MAX", "DB_POOL_MAX", "PG_POOL_MAX", "NEXT_CACHE_HANDLER"):
                    env[e["name"]] = e["value"]
        tasks = (aws("ecs", "list-tasks", "--cluster", ecs_cluster, "--service-name", s["serviceName"]) or {}).get("taskArns", [])
        task_azs = []
        if tasks:
            for t in (aws("ecs", "describe-tasks", "--cluster", ecs_cluster, "--tasks", *tasks[:20]) or {}).get("tasks", []):
                task_azs.append(t.get("availabilityZone"))
        out("ECS_SERVICE", s["serviceName"], "cpu=%s" % td.get("cpu"), "memoryMiB=%s" % td.get("memory"),
            "desired=%s" % s.get("desiredCount"), "running=%s" % s.get("runningCount"),
            "launch=%s" % (s.get("launchType") or (s.get("capacityProviderStrategy") or [{}])[0].get("capacityProvider")),
            "subnetAZs=%s" % ",".join(sorted(a for a in azs if a)), "taskAZs=%s" % ",".join(sorted(a for a in task_azs if a)),
            "deployMin/Max=%s/%s" % ((s.get("deploymentConfiguration") or {}).get("minimumHealthyPercent"),
                                     (s.get("deploymentConfiguration") or {}).get("maximumPercent")),
            "env=%s" % json.dumps(env, sort_keys=True))
    targets = (aws("application-autoscaling", "describe-scalable-targets", "--service-namespace", "ecs") or {}).get("ScalableTargets", [])
    policies = (aws("application-autoscaling", "describe-scaling-policies", "--service-namespace", "ecs") or {}).get("ScalingPolicies", [])
    out("ECS_AUTOSCALING_TARGETS", len(targets))
    for t in targets:
        out("ECS_AUTOSCALING", t["ResourceId"].split("/")[-1], "min=%s" % t["MinCapacity"], "max=%s" % t["MaxCapacity"])
    for p in policies:
        cfg = p.get("TargetTrackingScalingPolicyConfiguration") or {}
        out("ECS_SCALING_POLICY", p["ResourceId"].split("/")[-1], p.get("PolicyType"),
            "target=%s" % cfg.get("TargetValue"),
            "metric=%s" % ((cfg.get("PredefinedMetricSpecification") or {}).get("PredefinedMetricType")))

    c = cluster()
    sv2 = c.get("ServerlessV2ScalingConfiguration") or {}
    out("AURORA", "engine=%s %s" % (c.get("Engine"), c.get("EngineVersion")), "minACU=%s" % sv2.get("MinCapacity"),
        "maxACU=%s" % sv2.get("MaxCapacity"), "members=%s" % len(c.get("DBClusterMembers", [])),
        "writers=%s" % sum(1 for m in c.get("DBClusterMembers", []) if m.get("IsClusterWriter")),
        "dataApi=%s" % c.get("HttpEndpointEnabled"), "multiAZ=%s" % c.get("MultiAZ"))
    for m in c.get("DBClusterMembers", []):
        inst = (aws("rds", "describe-db-instances", "--db-instance-identifier", m["DBInstanceIdentifier"]) or {}).get("DBInstances", [{}])[0]
        out("AURORA_INSTANCE", "writer" if m.get("IsClusterWriter") else "reader", "class=%s" % inst.get("DBInstanceClass"),
            "az=%s" % inst.get("AvailabilityZone"), "pi=%s" % inst.get("PerformanceInsightsEnabled"),
            "piRetentionDays=%s" % inst.get("PerformanceInsightsRetentionPeriod"))
    proxies = (aws("rds", "describe-db-proxies") or {}).get("DBProxies", [])
    out("RDS_PROXY", "count=%d" % len(proxies))
    settings = sql_rows([
        "show max_connections",
        "select count(*)::int as total, count(*) filter (where state = 'active')::int as active, "
        "count(*) filter (where state = 'idle')::int as idle from pg_stat_activity where backend_type = 'client backend'",
        "select coalesce(application_name, '') as app, count(*)::int as n from pg_stat_activity "
        "where backend_type = 'client backend' group by 1 order by 2 desc limit 8",
        "select extname, extversion from pg_extension where extname in ('pg_stat_statements')",
        "show statement_timeout",
        "show idle_in_transaction_session_timeout",
    ])
    labels = ["MAX_CONNECTIONS", "CONNECTIONS_NOW", "CONNECTIONS_BY_APP", "PG_STAT_STATEMENTS", "STATEMENT_TIMEOUT", "IDLE_TX_TIMEOUT"]
    for label, rows in zip(labels, settings):
        out("DB", label, json.dumps(rows)[:600] if rows is not None else "UNAVAILABLE")

    apis = (aws("apigatewayv2", "get-apis") or {}).get("Items", [])
    for a in apis:
        if PREFIX in a.get("Name", "") or "realtime" in a.get("Name", ""):
            out("REALTIME_API", a.get("Name"), a.get("ProtocolType"), "id=%s" % a.get("ApiId"))
            stages = (aws("apigatewayv2", "get-stages", "--api-id", a["ApiId"]) or {}).get("Items", [])
            for st in stages:
                rs = st.get("DefaultRouteSettings") or {}
                out("REALTIME_STAGE", st.get("StageName"), "throttleRate=%s" % rs.get("ThrottlingRateLimit"),
                    "throttleBurst=%s" % rs.get("ThrottlingBurstLimit"))
    table = (aws("dynamodb", "describe-table", "--table-name", PREFIX + "-realtime-connections") or {}).get("Table", {})
    out("REALTIME_TABLE", "billing=%s" % ((table.get("BillingModeSummary") or {}).get("BillingMode")),
        "itemCountApprox=%s" % table.get("ItemCount"))
    lambdas = (aws("lambda", "list-functions") or {}).get("Functions", [])
    for f in lambdas:
        if PREFIX in f.get("FunctionName", ""):
            conc = aws("lambda", "get-function-concurrency", "--function-name", f["FunctionName"], quiet=True) or {}
            out("LAMBDA", f["FunctionName"].replace(PREFIX + "-", ""), "memMB=%s" % f.get("MemorySize"),
                "timeout=%s" % f.get("Timeout"), "reserved=%s" % conc.get("ReservedConcurrentExecutions"))
    acct = aws("lambda", "get-account-settings") or {}
    out("LAMBDA_ACCOUNT_CONCURRENCY", (acct.get("AccountLimit") or {}).get("ConcurrentExecutions"))

    dists = ((aws("cloudfront", "list-distributions", region=EDGE) or {}).get("DistributionList") or {}).get("Items", [])
    for d in dists:
        aliases = (d.get("Aliases") or {}).get("Items", [])
        if not any("seanshore" in a for a in aliases):
            continue
        out("CLOUDFRONT", d["Id"], "aliases=%s" % ",".join(aliases), "priceClass=%s" % d.get("PriceClass"),
            "http=%s" % d.get("HttpVersion"))
        behaviors = [("default", d["DefaultCacheBehavior"])] + [(b["PathPattern"], b) for b in (d.get("CacheBehaviors") or {}).get("Items", [])]
        policies = {}
        for path, b in behaviors:
            pid = b.get("CachePolicyId")
            if pid and pid not in policies:
                cp = (aws("cloudfront", "get-cache-policy", "--id", pid, region=EDGE) or {}).get("CachePolicy", {}).get("CachePolicyConfig", {})
                policies[pid] = "%s(min=%s,default=%s,max=%s)" % (cp.get("Name"), cp.get("MinTTL"), cp.get("DefaultTTL"), cp.get("MaxTTL"))
            origin = b.get("TargetOriginId", "")
            out("CF_BEHAVIOR", path, "origin=%s" % re.sub(r"\d{12}", "[acct]", origin), "compress=%s" % b.get("Compress"),
                "cache=%s" % policies.get(pid, "legacy-forwarded-values"))
        sub = aws("cloudfront", "get-monitoring-subscription", "--distribution-id", d["Id"], region=EDGE, quiet=True) or {}
        out("CF_ADDITIONAL_METRICS", ((sub.get("MonitoringSubscription") or {}).get("RealtimeMetricsSubscriptionConfig") or {}).get("RealtimeMetricsSubscriptionStatus", "Disabled"))

    acls = (aws("wafv2", "list-web-acls", "--scope", "CLOUDFRONT", region=EDGE) or {}).get("WebACLs", [])
    for a in acls:
        if PREFIX not in a.get("Name", ""):
            continue
        acl = (aws("wafv2", "get-web-acl", "--scope", "CLOUDFRONT", "--name", a["Name"], "--id", a["Id"], region=EDGE) or {}).get("WebACL", {})
        for r in acl.get("Rules", []):
            st = r.get("Statement", {})
            rate = st.get("RateBasedStatement")
            managed = st.get("ManagedRuleGroupStatement")
            out("WAF_RULE", r.get("Name"), "priority=%s" % r.get("Priority"),
                ("rate=%s/%ss key=%s" % (rate.get("Limit"), rate.get("EvaluationWindowSec", 300), rate.get("AggregateKeyType")) if rate else
                 "managed=%s" % managed.get("Name") if managed else "custom"),
                "action=%s" % list((r.get("Action") or r.get("OverrideAction") or {}).keys()))

    for b in ("media", "private", "migration", "alb-logs"):
        bucket = "%s-%s-%s" % (PREFIX, ACCOUNT, b)
        lc = aws("s3api", "get-bucket-lifecycle-configuration", "--bucket", bucket, quiet=True) or {}
        ver = aws("s3api", "get-bucket-versioning", "--bucket", bucket, quiet=True) or {}
        rules = ["%s:%s" % (r.get("ID"), ",".join(k for k in ("Expiration", "Transitions", "NoncurrentVersionExpiration", "AbortIncompleteMultipartUpload") if k in r)) for r in lc.get("Rules", [])]
        out("S3_BUCKET", b, "versioning=%s" % ver.get("Status", "Off"), "lifecycle=%s" % (rules or "none"))

    alarms = (aws("cloudwatch", "describe-alarms") or {}).get("MetricAlarms", [])
    out("CW_ALARMS", len(alarms))
    for a in alarms:
        out("CW_ALARM", a.get("AlarmName", "").replace(PREFIX + "-", ""), a.get("MetricName"),
            "%s %s" % (a.get("ComparisonOperator"), a.get("Threshold")), "periods=%s" % a.get("EvaluationPeriods"))

    public_ipv4_inventory(ecs_cluster, names)
    pg_stat_statements_readiness()
    lambda_concurrency_quota()


# Round P3 (B10): AWS bills every public IPv4 address, US$0.005 an hour (about US$3.65 a month). Lists what holds
# each one, by kind and name. Addresses themselves are never printed (the Actions log is public).
PUBLIC_IPV4_USD_PER_MONTH = 3.65


def public_ipv4_inventory(ecs_cluster, service_names):
    out("=== B10 PUBLIC IPV4 ===")
    eni_service = {}
    for name in service_names:
        tasks = (aws("ecs", "list-tasks", "--cluster", ecs_cluster, "--service-name", name) or {}).get("taskArns", [])
        for t in (aws("ecs", "describe-tasks", "--cluster", ecs_cluster, "--tasks", *tasks[:100]) or {}).get("tasks", []) if tasks else []:
            for attachment in t.get("attachments", []):
                for d in attachment.get("details", []):
                    if d.get("name") == "networkInterfaceId":
                        eni_service[d.get("value")] = name
    instance_names = {}
    for r in (aws("ec2", "describe-instances") or {}).get("Reservations", []):
        for i in r.get("Instances", []):
            tags = {t["Key"]: t["Value"] for t in i.get("Tags", [])}
            instance_names[i["InstanceId"]] = "%s(%s,%s)" % (tags.get("Name", "untagged"), i.get("InstanceType"), (i.get("State") or {}).get("Name"))
    holders = Counter()
    for eni in (aws("ec2", "describe-network-interfaces") or {}).get("NetworkInterfaces", []):
        association = eni.get("Association") or {}
        if not association.get("PublicIp"):
            continue
        description = eni.get("Description") or ""
        instance = (eni.get("Attachment") or {}).get("InstanceId")
        if eni.get("NetworkInterfaceId") in eni_service:
            holder = "ecs-task:%s" % eni_service[eni["NetworkInterfaceId"]].replace(PREFIX + "-", "")
        elif description.startswith("ELB app/"):
            holder = "load-balancer:%s" % description.split("/")[1].replace(PREFIX + "-", "")
        elif instance:
            holder = "ec2:%s" % instance_names.get(instance, "unknown")
        else:
            holder = "%s:%s" % (eni.get("InterfaceType", "interface"), re.sub(r"[0-9a-f]{8,}", "[id]", description)[:60] or "no-description")
        elastic = "elastic" if association.get("AllocationId") or association.get("IpOwnerId") not in (None, "amazon") else "auto"
        holders[(holder, elastic)] += 1
    unattached = [a for a in (aws("ec2", "describe-addresses") or {}).get("Addresses", []) if not a.get("AssociationId")]
    for (holder, elastic), count in sorted(holders.items()):
        out("PUBLIC_IPV4", "holder=%s" % holder, "kind=%s" % elastic, "count=%d" % count,
            "usd_per_month=%.2f" % (count * PUBLIC_IPV4_USD_PER_MONTH))
    if unattached:
        out("PUBLIC_IPV4", "holder=unattached-elastic-ip", "kind=elastic", "count=%d" % len(unattached),
            "usd_per_month=%.2f" % (len(unattached) * PUBLIC_IPV4_USD_PER_MONTH))
    total = sum(holders.values()) + len(unattached)
    out("PUBLIC_IPV4_TOTAL", total, "usd_per_month=%.2f" % (total * PUBLIC_IPV4_USD_PER_MONTH))


# Round P3 (B1): the account-wide Lambda concurrency limit (10 before the owner's Service Quotas request for 1,000),
# the applied quota value and the status of the latest increase request.
LAMBDA_CONCURRENCY_QUOTA = "L-B99A9384"


def lambda_concurrency_quota():
    out("=== B1 LAMBDA CONCURRENCY ===")
    settings = (aws("lambda", "get-account-settings") or {}).get("AccountLimit") or {}
    out("LAMBDA_ACCOUNT_CONCURRENT_EXECUTIONS", settings.get("ConcurrentExecutions"),
        "unreserved=%s" % settings.get("UnreservedConcurrentExecutions"))
    quota = (aws("service-quotas", "get-service-quota", "--service-code", "lambda",
                 "--quota-code", LAMBDA_CONCURRENCY_QUOTA) or {}).get("Quota") or {}
    out("LAMBDA_CONCURRENCY_QUOTA_APPLIED", quota.get("Value"))
    history = (aws("service-quotas", "list-requested-service-quota-change-history-by-quota", "--service-code", "lambda",
                   "--quota-code", LAMBDA_CONCURRENCY_QUOTA) or {}).get("RequestedQuotas", [])
    for request in sorted(history, key=lambda r: r.get("Created") or "", reverse=True)[:3]:
        out("LAMBDA_CONCURRENCY_REQUEST", "desired=%s" % request.get("DesiredValue"), "status=%s" % request.get("Status"),
            "created=%s" % request.get("Created"), "updated=%s" % request.get("LastUpdated"))


# Round P3 (B9): whether pg_stat_statements can be installed without a reboot (Aurora preloads it unless the
# cluster parameter group changed shared_preload_libraries).
def pg_stat_statements_readiness():
    out("=== B9 PG_STAT_STATEMENTS ===")
    c = cluster()
    group = c.get("DBClusterParameterGroup")
    params = (aws("rds", "describe-db-cluster-parameters", "--db-cluster-parameter-group-name", group,
                  "--query", "Parameters[?ParameterName=='shared_preload_libraries']") or []) if group else []
    for prm in params if isinstance(params, list) else []:
        out("PGSS_CLUSTER_PARAMETER", "group=%s" % group, "value=%s" % prm.get("ParameterValue"),
            "source=%s" % prm.get("Source"), "apply=%s" % prm.get("ApplyType"))
    preload, extension = sql_rows(["show shared_preload_libraries",
                                   "select extname, extversion from pg_extension where extname = 'pg_stat_statements'"])
    out("PGSS_PRELOADED", json.dumps(preload))
    out("PGSS_EXTENSION", json.dumps(extension))


# ---------------------------------------------------------------- section: usage

STATIC = re.compile(r"^/(_next/static|brand/|landing/|favicon|apple-touch-icon|manifest\.webmanifest|robots\.txt|sitemap)|\.(png|jpe?g|webp|avif|gif|svg|ico|css|js|map|woff2?|txt|xml)$", re.I)
LOG_LINE = re.compile(r'^(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) "([^"]*)" "([^"]*)"')
# Literal route directory names from src/app (code, never member data). Any other path segment prints as :x.
ROUTE_WORDS = frozenset([
    "about", "access", "accessibility", "account", "account-deleted", "activities", "admin", "alerts",
    "analytics", "api", "app", "app-handoff", "applicants", "applications", "assignment-attachments", "assignments",
    "attachments", "audit", "auth", "backup", "batches", "billing", "blocked", "branding",
    "calendar", "callback", "candidates", "captions", "cashfree", "catch-up", "categories", "certificates",
    "changes", "claim", "claim-profile", "communities", "community", "community-categories", "community-media", "company",
    "company-cover", "company-invitations", "company-logo", "confirm", "contact", "content", "copyright", "courses",
    "create", "creator", "credit-notes", "csp-report", "cv", "delete", "deleted-content", "deleted-posts",
    "dg-profile", "documents", "earnings", "edit", "email", "enrollment", "events", "export",
    "feed", "feed-media", "fees", "fonts", "forgot-password", "google", "hashtags", "health",
    "help", "hiring", "home", "hosting", "image", "impressions", "invoices", "jobs",
    "join", "learn", "learners", "learning", "learning-media", "legacy", "legacy-invites", "live",
    "manage", "media", "messages", "messaging-state", "metrics", "mfa", "moderation", "my",
    "my-learning", "network", "new", "newsletter", "notifications", "og-image", "onboarding", "organization",
    "organization-conversion", "organization-search", "organizations", "payments", "payouts", "people", "phone", "plans",
    "post-sign-in", "posts", "preview", "pricing", "privacy", "profile", "promo-codes", "public",
    "question-bank", "quiz", "ranking", "razorpay", "realtime", "receipts", "recipients", "recording",
    "refunds", "register", "registrations", "requests", "resend", "restore", "return", "review",
    "roster", "sales", "saved", "scorm", "search", "security", "seller-invoices", "session-ended",
    "sessions", "settings", "share-image", "shipping", "sign-in", "sign-up", "sitemaps", "start",
    "status", "studio", "suggest", "support", "tax", "tds", "teach", "team",
    "template", "terms", "test-link", "test-unsubscribe", "ticket", "training", "transactions", "typing-token",
    "unsubscribe", "update-password", "users", "verifications", "visit", "webhook",
])


BOT_PATTERN = r"bot|crawl|spider|slurp|HealthProbe|ELB-HealthChecker|Lighthouse|curl|python|Go-http|axios|node-fetch|headless|SeaNShore-LoadTest"
# Round DB: the load test names its ramp step in the User-Agent ("SeaNShore-LoadTest/1 step/N"), so the server-side
# (ALB target) times are cut per step exactly. LOAD_TEST_STEP_RPM is the ramp's target rate per step (the load test's
# report passes it); "p95 under 1 s" is judged on these server-side times (owner-approved 11 Nov).
LOAD_TEST_STEP = re.compile(r"SeaNShore-LoadTest/1 step/(\d+)")
STEP_RPM = [int(x) for x in os.environ.get("LOAD_TEST_STEP_RPM", "").split(",") if x.strip().isdigit()]
STEP_STATS = defaultdict(lambda: {"times": [], "n": 0, "5xx": 0})


def request_kind(method, path, query):
    return ("image" if path.startswith("/_next/image") else "rsc" if "_rsc=" in query else
            "action" if method == "POST" and not path.startswith("/api/") else "api" if path.startswith("/api/") else "page")


def route_shape(path):
    parts = [p for p in path.split("/") if p][:3]
    return "/" + "/".join(p.lower() if p.lower() in ROUTE_WORDS else ":x" for p in parts)


def parse_alb_line(line, totals, per_minute, by_route, errors_by_route, bot):
    m = LOG_LINE.match(line)
    if not m:
        return
    t = m.group(2)
    # Whole seconds: "...:00.5Z" sorts before "...:00Z" as text.
    if t[:19] < iso(START)[:19] or t[:19] >= iso(NOW)[:19]:
        return
    target_time = float(m.group(7))
    status = m.group(9)
    request = m.group(13).split(" ")
    method = request[0] if request else "-"
    url = request[1] if len(request) > 1 else ""
    path = re.sub(r"^https?://[^/]+(:\d+)?", "", url).split("?")[0] or "/"
    query = url.split("?", 1)[1] if "?" in url else ""
    ua = m.group(14)
    step = LOAD_TEST_STEP.search(ua)
    if step:
        st = STEP_STATS[int(step.group(1))]
        st["n"] += 1
        if target_time >= 0:
            st["times"].append(target_time)
        if status.startswith("5"):
            st["5xx"] += 1
    totals["requests"] += 1
    per_minute[t[:16]] += 1
    if bot.search(ua):
        totals["bot_or_probe"] += 1
    if STATIC.search(path):
        totals["static_at_origin"] += 1
        return
    key = "%s %s" % (request_kind(method, path, query), route_shape(path))
    if target_time >= 0:
        by_route[key].append(target_time)
    if status.startswith("5"):
        errors_by_route[key] += 1
        totals["5xx"] += 1


def server_step_lines(step_stats, step_rpm):
    """Round DB: the load test's server-side (ALB target) times per ramp step, and the highest step, counting up from
    the first, whose p95 is under 1 s with server errors at 1% or less. Aggregates only."""
    lines, highest, broken = [], 0, False
    for n in sorted(step_stats):
        st = step_stats[n]
        times = st["times"]
        if not st["n"]:
            continue
        p95 = pct(times, 95) if times else None
        errors = st["5xx"] / st["n"]
        within = p95 is not None and p95 < 1.0 and errors <= 0.01
        if within and not broken and n == highest + 1:
            highest = n
        else:
            broken = True
        lines.append(" ".join([
            "LOAD_TEST_STEP_SERVER step=%d" % n, "target_rpm=%s" % (step_rpm[n - 1] if 0 < n <= len(step_rpm) else "?"),
            "requests=%d" % st["n"], "p50_s=%s" % ("%.3f" % pct(times, 50) if times else "n/a"),
            "p95_s=%s" % ("%.3f" % p95 if p95 is not None else "n/a"), "p99_s=%s" % ("%.3f" % pct(times, 99) if times else "n/a"),
            "server_5xx_pct=%.2f" % (100 * errors), "within_1s=%s" % str(within).lower(), "measured_at=alb_target",
        ]))
    if lines:
        lines.append("LOAD_TEST_P95_UNDER_1S_SERVER highest_step=%d highest_rpm=%s measured_at=alb_target" % (
            highest, step_rpm[highest - 1] if 0 < highest <= len(step_rpm) else 0))
    return lines


def alb_day_lines(day, totals, budget):
    """Yields every line of one UTC day's ALB access logs, read from a temporary download. Stops at a 6 GB total."""
    bucket = "%s-%s-alb-logs" % (PREFIX, ACCOUNT)
    prefix = "alb/AWSLogs/%s/elasticloadbalancing/%s/%04d/%02d/%02d/" % (ACCOUNT, REGION, day.year, day.month, day.day)
    listing = aws("s3api", "list-objects-v2", "--bucket", bucket, "--prefix", prefix) or {}
    day_bytes = sum(o["Size"] for o in listing.get("Contents", []))
    if not day_bytes:
        return
    if budget["bytes"] + day_bytes > 6 * 1024 ** 3:
        totals["days_skipped_size_cap"] += 1
        return
    budget["bytes"] += day_bytes
    with tempfile.TemporaryDirectory() as tmp:
        got = subprocess.run(["aws", "s3", "cp", "s3://%s/%s" % (bucket, prefix), tmp, "--recursive", "--only-show-errors",
                              "--region", REGION], capture_output=True, timeout=1800)
        if got.returncode != 0:
            totals["log_days_read_errors"] += 1
            return
        for root, _dirs, files in os.walk(tmp):
            for file_name in files:
                with gzip.open(os.path.join(root, file_name), "rt", errors="replace") as fh:
                    yield from fh


def alb_log_stats():
    totals = Counter()
    per_minute = Counter()
    by_route = defaultdict(list)
    errors_by_route = Counter()
    bot = re.compile(BOT_PATTERN, re.I)
    budget = {"bytes": 0}
    day = START.date()
    while day <= NOW.date():
        for line in alb_day_lines(day, totals, budget):
            parse_alb_line(line, totals, per_minute, by_route, errors_by_route, bot)
        day += dt.timedelta(days=1)
    bytes_scanned = budget["bytes"]
    out("ALB_LOGS", "scannedMB=%s" % mb(bytes_scanned), json.dumps(dict(totals)))
    if per_minute:
        rpm = list(per_minute.values())
        out("ALB_REQ_PER_MIN", "avg_nonzero=%s" % round(statistics.fmean(rpm), 2), "p95=%s" % pct(rpm, 95), "max=%s" % max(rpm),
            "minutesWithTraffic=%d" % len(rpm), "of=%d" % (DAYS * 1440))
    ranked = sorted(by_route.items(), key=lambda kv: -len(kv[1]))[:30]
    for key, times in ranked:
        out("ROUTE", key, "n=%d" % len(times), "p50=%.3f" % pct(times, 50), "p95=%.3f" % pct(times, 95),
            "p99=%.3f" % pct(times, 99), "max=%.3f" % max(times), "wallSecTotal=%.0f" % sum(times), "5xx=%d" % errors_by_route[key])
    for line in server_step_lines(STEP_STATS, STEP_RPM):
        out(line)
    for key in ("image /:x/image", "page /home", "rsc /home", "page /jobs", "rsc /jobs", "page /jobs/:x", "page /messages", "rsc /messages", "api /api/:x"):
        if key in by_route:
            times = by_route[key]
            out("FOCUS", key, "n=%d" % len(times), "p50=%.3f p95=%.3f p99=%.3f" % (pct(times, 50), pct(times, 95), pct(times, 99)))


def section_usage():
    out("=== A2 WHAT WE USE (last %d days, UTC %s to %s) ===" % (DAYS, iso(START), iso(NOW)))
    for dims in search_dims("AWS/ApplicationELB", "RequestCount", PREFIX + "-alb"):
        if "TargetGroup" in dims:
            continue
        summarize("alb.requests_per_min", metric_series("AWS/ApplicationELB", "RequestCount", dims, "Sum", 60))
        summarize("alb.elb_5xx_per_5min", metric_series("AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", dims, "Sum", 300))
    for dims in search_dims("AWS/ApplicationELB", "TargetResponseTime", PREFIX + "-web"):
        if "TargetGroup" not in dims:
            continue
        for stat in ("p50", "p95", "p99"):
            summarize("alb.target_response_%s_hourly_s" % stat, metric_series("AWS/ApplicationELB", "TargetResponseTime", dims, stat, 3600))
        summarize("alb.target_5xx_per_5min", metric_series("AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", dims, "Sum", 300))
        summarize("alb.healthy_hosts_min", metric_series("AWS/ApplicationELB", "HealthyHostCount", dims, "Minimum", 300))
    clusters = aws("ecs", "list-clusters") or {}
    ecs_cluster = next((a.split("/")[-1] for a in clusters.get("clusterArns", []) if PREFIX in a), None)
    for svc in (PREFIX + "-web", PREFIX + "-outbox-worker", PREFIX + "-notification-worker"):
        for name in ("CPUUtilization", "MemoryUtilization"):
            summarize("ecs.%s.%s_avg_per_min" % (svc.replace(PREFIX + "-", ""), name),
                      metric_series("AWS/ECS", name, {"ClusterName": ecs_cluster, "ServiceName": svc}, "Average", 60))
            summarize("ecs.%s.%s_max_per_min" % (svc.replace(PREFIX + "-", ""), name),
                      metric_series("AWS/ECS", name, {"ClusterName": ecs_cluster, "ServiceName": svc}, "Maximum", 60))
    for name, stat in (("CPUUtilization", "Average"), ("DatabaseConnections", "Maximum"), ("ServerlessDatabaseCapacity", "Maximum"),
                       ("ACUUtilization", "Maximum"), ("ReadLatency", "Average"), ("WriteLatency", "Average"), ("Deadlocks", "Sum")):
        summarize("aurora.%s_%s_per_min" % (name, stat.lower()), metric_series("AWS/RDS", name, {"DBClusterIdentifier": CLUSTER_ID}, stat, 60))
    for dims in search_dims("AWS/CloudFront", "Requests", "", region=EDGE):
        if dims.get("Region") != "Global":
            continue
        cf = "cloudfront[%s]" % dims.get("DistributionId")
        summarize(cf + ".requests_per_min", metric_series("AWS/CloudFront", "Requests", dims, "Sum", 60, region=EDGE))
        total_bytes = metric_series("AWS/CloudFront", "BytesDownloaded", dims, "Sum", 86400, region=EDGE)
        out("METRIC", cf + ".bytes_downloaded_%dd_GB" % DAYS, round(sum(total_bytes) / 1024 ** 3, 2))
        summarize(cf + ".cache_hit_rate_hourly_pct", metric_series("AWS/CloudFront", "CacheHitRate", dims, "Average", 3600, region=EDGE))
        summarize(cf + ".5xx_rate_pct", metric_series("AWS/CloudFront", "5xxErrorRate", dims, "Average", 300, region=EDGE))
    for a in (aws("apigatewayv2", "get-apis") or {}).get("Items", []):
        if a.get("ProtocolType") == "WEBSOCKET":
            summarize("realtime.connects_per_5min", metric_series("AWS/ApiGateway", "ConnectCount", {"ApiId": a["ApiId"]}, "Sum", 300))
            summarize("realtime.messages_per_5min", metric_series("AWS/ApiGateway", "MessageCount", {"ApiId": a["ApiId"]}, "Sum", 300))
    for f in (aws("lambda", "list-functions") or {}).get("Functions", []):
        if PREFIX in f.get("FunctionName", "") and "realtime" in f.get("FunctionName", ""):
            summarize("lambda.%s.concurrency_max" % f["FunctionName"].replace(PREFIX + "-", ""),
                      metric_series("AWS/Lambda", "ConcurrentExecutions", {"FunctionName": f["FunctionName"]}, "Maximum", 300))

    out("=== SLOWEST QUERIES (shapes only) ===")
    c = cluster()
    writer = next((m["DBInstanceIdentifier"] for m in c.get("DBClusterMembers", []) if m.get("IsClusterWriter")), None)
    inst = (aws("rds", "describe-db-instances", "--db-instance-identifier", writer) or {}).get("DBInstances", [{}])[0] if writer else {}
    resource = inst.get("DbiResourceId")
    if resource and inst.get("PerformanceInsightsEnabled"):
        pi_start = max(START, NOW - dt.timedelta(days=7))
        load = aws("pi", "get-resource-metrics", "--service-type", "RDS", "--identifier", resource, "--start-time", iso(pi_start),
                   "--end-time", iso(NOW), "--period-in-seconds", "3600", "--metric-queries", '[{"Metric":"db.load.avg"}]') or {}
        series = [p.get("Value") for m in load.get("MetricList", []) for p in m.get("DataPoints", []) if p.get("Value") is not None]
        summarize("pi.db_load_avg_hourly_AAS_7d", series)
        top = aws("pi", "describe-dimension-keys", "--service-type", "RDS", "--identifier", resource, "--start-time", iso(pi_start),
                  "--end-time", iso(NOW), "--metric", "db.load.avg", "--group-by", '{"Group":"db.sql_tokenized","Limit":10}') or {}
        for k in top.get("Keys", []):
            statement = (k.get("Dimensions") or {}).get("db.sql_tokenized.statement", "")
            out("PI_TOP", "load=%.4f" % k.get("Total", 0), re.sub(r"\s+", " ", statement)[:220])
    rows = sql_rows([
        "select calls::bigint as calls, round(mean_exec_time::numeric, 1) as mean_ms, round(max_exec_time::numeric, 0) as max_ms, "
        "round(total_exec_time::numeric / 1000, 0) as total_s, left(regexp_replace(query, '\\s+', ' ', 'g'), 200) as query "
        "from pg_stat_statements where calls >= 20 order by mean_exec_time desc limit 10",
        "select calls::bigint as calls, round(mean_exec_time::numeric, 1) as mean_ms, round(total_exec_time::numeric / 1000, 0) as total_s, "
        "left(regexp_replace(query, '\\s+', ' ', 'g'), 200) as query from pg_stat_statements order by total_exec_time desc limit 10",
        "select stats_reset from pg_stat_statements_info",
    ])
    for label, r in zip(("PGSS_SLOWEST_MEAN", "PGSS_MOST_TOTAL_TIME", "PGSS_SINCE"), rows):
        if r is None:
            out(label, "UNAVAILABLE")
            continue
        for row in r:
            out(label, json.dumps(row)[:320])

    out("=== MEMBERS AND ACTIVITY (counts only) ===")
    rows = sql_rows([
        "select count(*)::int as members from public.profiles",
        "select count(distinct profile_id) filter (where last_seen_at > now() - interval '5 minutes')::int as active_5m, "
        "count(distinct profile_id) filter (where last_seen_at > now() - interval '1 day')::int as active_1d, "
        "count(distinct profile_id) filter (where last_seen_at > now() - interval '7 days')::int as active_7d, "
        "count(distinct profile_id) filter (where last_seen_at > now() - interval '30 days')::int as active_30d "
        "from public.auth_sessions where revoked_at is null",
        "with buckets as (select date_trunc('hour', first_seen_at) as h, count(distinct viewer_id) as viewers "
        "from public.post_impressions where first_seen_at > now() - interval '14 days' group by 1) "
        "select max(viewers)::int as peak_hour_feed_viewers, round(avg(viewers), 1) as avg_hour_feed_viewers from buckets",
        "with buckets as (select date_trunc('day', created_at) as d, count(distinct profile_id) as n "
        "from public.auth_sessions where created_at > now() - interval '14 days' group by 1) "
        "select max(n)::int as peak_day_sign_ins, round(avg(n), 1) as avg_day_sign_ins from buckets",
    ])
    for label, r in zip(("MEMBERS", "SIGNED_IN_ACTIVE", "FEED_VIEWERS_PER_HOUR", "SIGN_INS_PER_DAY"), rows):
        out(label, json.dumps(r) if r is not None else "UNAVAILABLE")

    out("=== PER-ROUTE LATENCY FROM ALB ACCESS LOGS ===")
    alb_log_stats()

    out("=== COST (Cost Explorer, by service) ===")
    month_start = NOW.replace(day=1, hour=0, minute=0).date()
    last_month_start = (month_start - dt.timedelta(days=1)).replace(day=1)
    for label, s, e in (("last_month", last_month_start, month_start), ("month_to_date", month_start, NOW.date())):
        if s >= e:
            continue
        data = aws("ce", "get-cost-and-usage", "--time-period", "Start=%s,End=%s" % (s, e), "--granularity", "MONTHLY",
                   "--metrics", "UnblendedCost", "--group-by", "Type=DIMENSION,Key=SERVICE", region=EDGE) or {}
        for period in data.get("ResultsByTime", []):
            groups = sorted(period.get("Groups", []), key=lambda g: -float(g["Metrics"]["UnblendedCost"]["Amount"]))
            total = sum(float(g["Metrics"]["UnblendedCost"]["Amount"]) for g in groups)
            out("COST", label, "%s..%s" % (s, e), "total_USD=%.2f" % total)
            for g in groups[:14]:
                out("COST_SERVICE", label, g["Keys"][0], "%.2f" % float(g["Metrics"]["UnblendedCost"]["Amount"]))


# ---------------------------------------------------------------- section: compare

# Round ARCH (Phase 5 measurement): the same hours on two days, after a change (COMPARE_START to COMPARE_END) and
# 24 hours earlier. COMPARE_SPLIT (optional) marks a deploy inside the window; both windows are also cut there.
# Background requests are Server Action POSTs (the timed polls are Server Actions). People online are counted as
# distinct real members with a new feed impression in each hour (load-test profiles excluded): Phase 5 does not
# change how members scroll, so the count is comparable across the two windows. Counts only, never member data.
REALTIME_FUNCTIONS = ("realtime-authorizer", "realtime-connection", "realtime-fanout",
                      "cognito-pre-sign-up-link", "cognito-resend-email-sender")


def parse_minute(value):
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


def compare_windows():
    after_start, after_end = parse_minute(os.environ["COMPARE_START"]), parse_minute(os.environ["COMPARE_END"])
    assert after_start < after_end <= after_start + dt.timedelta(hours=24), "the compare window must be under 24 hours"
    split = parse_minute(os.environ["COMPARE_SPLIT"]) if os.environ.get("COMPARE_SPLIT") else None
    assert split is None or after_start < split < after_end, "the split must fall inside the window"
    day = dt.timedelta(hours=24)
    return [("before", after_start - day, after_end - day), ("after", after_start, after_end)], split


def metric_points(namespace, name, dims, stat, period, start, end, region=REGION):
    """(timestamp, value) pairs of one metric between start and end."""
    q = {"Id": "m", "MetricStat": {"Metric": {"Namespace": namespace, "MetricName": name,
         "Dimensions": [{"Name": k, "Value": v} for k, v in dims.items()]}, "Period": period, "Stat": stat},
         "ReturnData": True}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump([q], f)
        path = f.name
    try:
        data = aws("cloudwatch", "get-metric-data", "--start-time", iso(start), "--end-time", iso(end),
                   "--metric-data-queries", "file://" + path, "--scan-by", "TimestampAscending", region=region)
    finally:
        os.unlink(path)
    points = []
    for r in (data or {}).get("MetricDataResults", []):
        for t, v in zip(r.get("Timestamps", []), r.get("Values", [])):
            points.append((dt.datetime.fromisoformat(t.replace("Z", "+00:00")), v))
    return points


def hour_index(t, start):
    return int((t - start).total_seconds() // 3600)


def ratio(a, b):
    return round(a / b, 3) if b else None


def change(before, after):
    return "%+.0f%%" % ((after - before) * 100 / before) if before else "n/a"


def section_compare():
    windows, split = compare_windows()
    hours = -(-int((windows[1][2] - windows[1][1]).total_seconds()) // 3600)
    out("=== PHASE 5 BEFORE AND AFTER (same hours, 24 hours apart) ===")
    for label, start, end in windows:
        out("COMPARE_WINDOW", label, iso(start), iso(end), "hours=%.2f" % ((end - start).total_seconds() / 3600))
    if split:
        out("COMPARE_SPLIT", iso(split), "(and %s in the before window)" % iso(split - dt.timedelta(hours=24)))
    split_hours = (split - windows[1][1]).total_seconds() / 3600 if split else None

    # ALB access logs, both windows in one pass.
    bot = re.compile(BOT_PATTERN, re.I)
    stats = {label: {"kinds": Counter(), "action_routes": Counter(), "api_routes": Counter(), "hourly": defaultdict(Counter),
                     "api_status": Counter(), "ticket_hourly": defaultdict(Counter)} for label, _s, _e in windows}
    bounds = [(label, iso(start)[:19], iso(end)[:19], start) for label, start, end in windows]
    totals, budget = Counter(), {"bytes": 0}
    day = windows[0][1].date()
    while day <= windows[1][2].date():
        for line in alb_day_lines(day, totals, budget):
            m = LOG_LINE.match(line)
            if not m:
                continue
            t = m.group(2)
            window = next((b for b in bounds if b[1] <= t[:19] < b[2]), None)
            if not window:
                continue
            label, _s, _e, start = window
            st = stats[label]
            st["kinds"]["requests"] += 1
            if bot.search(m.group(14)):
                st["kinds"]["bot_or_probe"] += 1
                continue
            request = m.group(13).split(" ")
            method = request[0] if request else "-"
            url = request[1] if len(request) > 1 else ""
            path = re.sub(r"^https?://[^/]+(:\d+)?", "", url).split("?")[0] or "/"
            query = url.split("?", 1)[1] if "?" in url else ""
            if STATIC.search(path):
                st["kinds"]["static_at_origin"] += 1
                continue
            kind = request_kind(method, path, query)
            st["kinds"][kind] += 1
            if m.group(9).startswith("5"):
                st["kinds"]["5xx"] += 1
            if m.group(9) in ("404", "500") and kind == "action":
                st["kinds"]["action_404_or_500"] += 1
            if kind in ("action", "api"):
                st[kind + "_routes"][route_shape(path)] += 1
            idx = hour_index(dt.datetime.strptime(t[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc), start)
            st["hourly"][idx][kind] += 1
            if kind == "api":
                # The ELB status (what the browser got) and, when the target answered, the app's own status.
                st["api_status"]["%s elb=%s target=%s" % (route_shape(path), m.group(9), m.group(10))] += 1
                if route_shape(path) == "/api/realtime/ticket":
                    st["ticket_hourly"][idx][m.group(9)] += 1
        day += dt.timedelta(days=1)
    out("COMPARE_ALB_LOGS", "scannedMB=%s" % mb(budget["bytes"]), json.dumps(dict(totals)))

    # People online: distinct real members with a new feed impression, per hour and over the whole window.
    statements = []
    for _label, start, end in windows:
        where = ("from public.post_impressions i join public.profiles p on p.id = i.viewer_id where not p.is_load_test "
                 "and i.first_seen_at >= timestamptz '%s' and i.first_seen_at < timestamptz '%s'" % (iso(start), iso(end)))
        statements.append("select floor(extract(epoch from (i.first_seen_at - timestamptz '%s')) / 3600)::int as h, "
                          "count(distinct i.viewer_id)::int as viewers %s group by 1 order by 1" % (iso(start), where))
        statements.append("select count(distinct i.viewer_id)::int as viewers %s" % where)
    rows = sql_rows(statements)
    for i, (label, _s, _e) in enumerate(windows):
        hourly, whole = rows[2 * i], rows[2 * i + 1]
        for r in hourly or []:
            stats[label]["hourly"][r["h"]]["viewers"] += r["viewers"]
        stats[label]["kinds"]["distinct_viewers"] = (whole or [{}])[0].get("viewers", 0)
        if hourly is None:
            out("COMPARE_VIEWERS", label, "UNAVAILABLE")

    # Realtime socket traffic and the five Lambdas.
    apis = [a for a in (aws("apigatewayv2", "get-apis") or {}).get("Items", []) if a.get("ProtocolType") == "WEBSOCKET"]
    for label, start, end in windows:
        for a in apis:
            for name, key in (("ConnectCount", "ws_connects"), ("MessageCount", "ws_messages")):
                for t, v in metric_points("AWS/ApiGateway", name, {"ApiId": a["ApiId"]}, "Sum", 300, start, end):
                    stats[label]["hourly"][hour_index(t, start)][key] += int(v)
                    stats[label]["kinds"][key] += int(v)
        for short in REALTIME_FUNCTIONS:
            fn = "%s-%s" % (PREFIX, short)
            values = {}
            for name, stat, agg in (("Invocations", "Sum", sum), ("Errors", "Sum", sum), ("Throttles", "Sum", sum),
                                    ("ConcurrentExecutions", "Maximum", max)):
                points = [v for _t, v in metric_points("AWS/Lambda", name, {"FunctionName": fn}, stat, 60, start, end)]
                values[name] = ("%d" % agg(points)) if points else "NO_DATA"
            out("COMPARE_LAMBDA", label, short, "invocations=%s" % values["Invocations"], "errors=%s" % values["Errors"],
                "throttles=%s" % values["Throttles"], "peak_concurrency_1min=%s" % values["ConcurrentExecutions"])
        for name in ("ConcurrentExecutions", "UnreservedConcurrentExecutions"):
            points = [v for _t, v in metric_points("AWS/Lambda", name, {}, "Maximum", 60, start, end)]
            out("COMPARE_LAMBDA_ACCOUNT", label, name + "_peak_1min=%s" % (int(max(points)) if points else "NO_DATA"))
    for short in REALTIME_FUNCTIONS:
        reserved = aws("lambda", "get-function-concurrency", "--function-name", "%s-%s" % (PREFIX, short)) or {}
        out("COMPARE_LAMBDA_RESERVED_NOW", short, reserved.get("ReservedConcurrentExecutions", "none"))

    # Per window and per hour.
    for label, _s, _e in windows:
        st = stats[label]
        out("COMPARE_ALB", label, json.dumps(dict(st["kinds"]), sort_keys=True))
        out("COMPARE_ACTION_ROUTES", label, " ".join("%s=%d" % kv for kv in st["action_routes"].most_common(12)) or "none")
        out("COMPARE_API_ROUTES", label, " ".join("%s=%d" % kv for kv in st["api_routes"].most_common(12)) or "none")
        out("COMPARE_API_STATUS", label, " ".join("%s=%d" % kv for kv in st["api_status"].most_common(20)) or "none")
        ticket = st["ticket_hourly"]
        out("COMPARE_TICKET_STATUS_BY_HOUR", label, " ".join(
            "h%d[%s]" % (h, ",".join("%s=%d" % kv for kv in sorted(ticket[h].items()))) for h in range(hours) if ticket[h]) or "none")
    for h in range(hours):
        parts = []
        for label, start, _e in windows:
            c = stats[label]["hourly"][h]
            parts.append("%s[%s action=%d api=%d rsc=%d page=%d viewers=%d ws_connects=%d ws_messages=%d]" % (
                label, (start + dt.timedelta(hours=h)).strftime("%dT%H:%M"), c["action"], c["api"], c["rsc"], c["page"],
                c["viewers"], c["ws_connects"], c["ws_messages"]))
        out("COMPARE_HOUR", "h=%d" % h, *parts)

    # The headline: background requests per person online, and per navigation.
    def headline(name, pick):
        results = {}
        for label, _s, _e in windows:
            hourly = stats[label]["hourly"]
            chosen = [hourly[h] for h in range(hours) if pick(h)]
            action = sum(c["action"] for c in chosen)
            person_hours = sum(c["viewers"] for c in chosen)
            navigations = sum(c["page"] + c["rsc"] for c in chosen)
            results[label] = (action, person_hours, navigations, ratio(action, person_hours), ratio(action, navigations))
            out("COMPARE_RESULT", name, label, "action_posts=%d" % action, "person_hours=%d" % person_hours,
                "navigations=%d" % navigations, "action_per_person_hour=%s" % results[label][3],
                "action_per_navigation=%s" % results[label][4])
        b, a = results["before"], results["after"]
        if b[3] is not None and a[3] is not None:
            out("COMPARE_CHANGE", name, "action_per_person_hour", change(b[3], a[3]), "action_per_navigation",
                change(b[4], a[4]) if b[4] and a[4] is not None else "n/a")

    headline("whole_window", lambda h: True)
    if split_hours is not None:
        headline("hours_before_split", lambda h: h + 1 <= split_hours)
        headline("hours_after_split", lambda h: h >= split_hours)


# Round CAP (finding 8): the hourly peak of signed-in members online, as the worker records it (counts only).
def section_online():
    out("=== ROUND CAP: PEAK SIGNED-IN MEMBERS ONLINE PER UTC HOUR (seen in the last 5 minutes; a floor) ===")
    windows, _split = compare_windows()
    start, end = windows[0][1], windows[-1][2]
    rows = sql_rows(["select day::text as day, substr(metric, 17)::int as hour, value::bigint as members "
                     "from public.ranking_metrics_daily where metric like 'online.peak_utc_h%%' "
                     "and day between date '%s' and date '%s' order by day, hour" % (start.date().isoformat(), end.date().isoformat())])[0]
    if rows is None:
        out("ONLINE UNAVAILABLE")
        return
    for label, a, b in windows:
        chosen = [r for r in rows if a <= dt.datetime.strptime("%s %02d" % (r["day"], int(r["hour"])), "%Y-%m-%d %H").replace(tzinfo=dt.timezone.utc) < b]
        values = [int(r["members"]) for r in chosen]
        out("ONLINE_PEAK", label, "hours_recorded=%d" % len(values), "peak=%s" % (max(values) if values else "n/a"),
            "avg_hourly_peak=%s" % (("%.1f" % statistics.fmean(values)) if values else "n/a"))
        out("ONLINE_PEAK_HOURS", label, " ".join("%sT%02d=%s" % (r["day"][5:], int(r["hour"]), r["members"]) for r in chosen) or "none")


# Owner (14 Nov): the people-online counts over the cap window, per UTC day (the worker's hourly peaks; a floor).
def section_caponline():
    out("=== ROUND CAP: PEAK SIGNED-IN MEMBERS ONLINE OVER THE CAP WINDOW (hourly peaks; counts only) ===")
    start, end = cap_window()
    rows = sql_rows(["select day::text as day, substr(metric, 17)::int as hour, value::bigint as members "
                     "from public.ranking_metrics_daily where metric like 'online.peak_utc_h%%' "
                     "and day between date '%s' and date '%s' order by day, hour" % (start.date().isoformat(), end.date().isoformat())])[0]
    if rows is None:
        out("CAP_ONLINE UNAVAILABLE")
        return
    inside = [r for r in rows if start <= dt.datetime.strptime("%s %02d" % (r["day"], int(r["hour"])), "%Y-%m-%d %H").replace(tzinfo=dt.timezone.utc) < end]
    values = [int(r["members"]) for r in inside]
    out("CAP_ONLINE", "hours_recorded=%d" % len(values), "peak=%s" % (max(values) if values else "n/a"),
        "avg_hourly_peak=%s" % (("%.1f" % statistics.fmean(values)) if values else "n/a"),
        "p90_hourly_peak=%s" % (sorted(values)[int(0.9 * (len(values) - 1))] if values else "n/a"))
    by_day = defaultdict(list)
    for r in inside:
        by_day[r["day"]].append(int(r["members"]))
    for day, v in sorted(by_day.items()):
        out("CAP_ONLINE_DAY", day, "hours=%d" % len(v), "peak=%d" % max(v), "avg=%.1f" % statistics.fmean(v))


# ---------------------------------------------------------------- sections: sessions (owner 15 Nov, read-only)

# Owner (15 Nov): an administrator using a phone and a laptop is signed out when moving between them. Window file
# "sessions <start> <end>" (at most 14 days): sign-ins started and ended per UTC day and why, ends near the same
# member's activity on another device, sign-ins started again without a recorded end, renewals made in parallel
# within the 60-second rotation grace, the admin step-up, and the reused-token count. Administrators are counted
# apart from members. Counts only: no ids, names, emails, devices, places or addresses.
SESSION_ADMINS_SQL = "admins as (select distinct user_id from public.user_roles where role::text = 'administrator')"
# A renewal is a refresh token Cognito issued (the ledger's row for it). The sign-in's own first token is written
# already exchanged (created_at = superseded_at), so it is not counted.
SESSION_MINTED_SQL = ("minted as (select t.token_hash, t.origin_hash, t.created_at, t.superseded_at from public.auth_refresh_tokens t "
                      "where t.superseded_at is null or t.superseded_at > t.created_at)")


def sessions_window():
    start, end = parse_minute(os.environ["SESS_START"]), parse_minute(os.environ["SESS_END"])
    assert start < end <= start + dt.timedelta(days=14), "the sessions window must be at most 14 days"
    return start, end


def session_statements(start, end):
    a, b = "timestamptz '%s'" % iso(start), "timestamptz '%s'" % iso(end)

    def day(col):
        return "(%s at time zone 'UTC')::date::text" % col

    def inside(col):
        return "%s >= %s and %s < %s" % (col, a, col, b)

    def near(col, at, before="5 minutes", after="1 minute"):
        return "%s between %s - interval '%s' and %s + interval '%s'" % (col, at, before, at, after)

    admin = "s.profile_id in (select user_id from admins)"
    # Owner (18 Nov): the load-test accounts are never counted (they exist only during a run, then are deleted).
    real = "not exists (select 1 from public.profiles lt where lt.id = s.profile_id and lt.is_load_test)"

    def inside_real(col):
        return "%s and %s" % (inside(col), real)

    started_ended = (
        "with %s select kind, day, is_admin, detail, count(*)::int as n from ("
        "select 'started' as kind, %s as day, %s as is_admin, s.sign_in_method as detail from public.auth_sessions s where %s "
        "union all select 'signed_out', %s, %s, s.revoke_reason from public.auth_sessions s where %s "
        "union all select 'reuse_ended', %s, %s, s.sign_in_method from public.auth_sessions s where %s"
        ") x group by 1, 2, 3, 4 order by 2, 1, 3, 4"
    ) % (SESSION_ADMINS_SQL, day("s.created_at"), admin, inside_real("s.created_at"), day("s.revoked_at"), admin,
         inside_real("s.revoked_at"), day("s.reuse_detected_at"), admin, inside_real("s.reuse_detected_at"))
    other_active = (
        "exists (select 1 from public.auth_sessions o where o.profile_id = e.profile_id and o.id <> e.id and (%s or %s or %s "
        "or exists (select 1 from minted m where m.origin_hash = o.token_origin_hash and %s)))"
    ) % (near("o.created_at", "e.end_at"), near("o.admin_step_up_at", "e.end_at"), near("o.last_seen_at", "e.end_at"),
         near("m.created_at", "e.end_at"))
    parallel_before_end = (
        "exists (select 1 from minted m1 join minted m2 on m2.origin_hash = m1.origin_hash and m2.token_hash <> m1.token_hash "
        "and m2.created_at >= m1.created_at and m2.created_at <= m1.created_at + interval '60 seconds' "
        "where m1.origin_hash = e.token_origin_hash and m2.created_at < e.end_at)")
    ends = (
        "with %s, %s, e as (select s.id, s.profile_id, s.token_origin_hash, coalesce(s.reuse_detected_at, s.revoked_at) as end_at, "
        "case when s.reuse_detected_at is not null then 'reuse' else s.revoke_reason end as reason, %s as is_admin "
        "from public.auth_sessions s where %s) "
        "select %s as day, e.is_admin, e.reason, count(*)::int as ended, "
        "count(*) filter (where %s)::int as other_device_active_near, "
        "count(*) filter (where exists (select 1 from public.auth_sessions o where o.profile_id = e.profile_id and o.id <> e.id "
        "and o.created_at > e.end_at and o.created_at <= e.end_at + interval '30 minutes'))::int as signed_in_again_30min, "
        "count(*) filter (where %s)::int as had_parallel_renewal "
        "from e group by 1, 2, 3 order by 1, 2, 3"
    ) % (SESSION_ADMINS_SQL, SESSION_MINTED_SQL, admin, inside_real("coalesce(s.reuse_detected_at, s.revoked_at)"),
         day("e.end_at"), other_active, parallel_before_end)
    # A sign-in started while an older one on the same kind of device (browser and system, the user agent summary)
    # never ended and was not used after it: the device lost its sign-in without our record of it ending.
    replaced = (
        "exists (select 1 from public.auth_sessions p where p.profile_id = n.profile_id and p.id <> n.id "
        "and p.user_agent_summary = n.user_agent_summary and p.created_at < n.created_at and p.revoked_at is null "
        "and p.reuse_detected_at is null and p.last_seen_at > n.created_at - interval '30 days' "
        "and p.last_seen_at <= n.created_at + interval '5 minutes')")
    other_before = (
        "exists (select 1 from public.auth_sessions o where o.profile_id = n.profile_id and o.id <> n.id "
        "and o.user_agent_summary is distinct from n.user_agent_summary and (%s "
        "or exists (select 1 from minted m where m.origin_hash = o.token_origin_hash and %s)))"
    ) % (near("o.last_seen_at", "n.created_at", "30 minutes", "0 minutes"), near("m.created_at", "n.created_at", "30 minutes", "0 minutes"))
    restarted = (
        "with %s, %s, n as (select s.id, s.profile_id, s.user_agent_summary, s.created_at, %s as is_admin "
        "from public.auth_sessions s where %s and s.user_agent_summary is not null) "
        "select %s as day, n.is_admin, count(*)::int as sign_ins, count(*) filter (where %s)::int as replaced_unended, "
        "count(*) filter (where %s and %s)::int as replaced_after_other_device "
        "from n group by 1, 2 order by 1, 2"
    ) % (SESSION_ADMINS_SQL, SESSION_MINTED_SQL, admin, inside_real("s.created_at"), day("n.created_at"), replaced, replaced, other_before)
    renewals = (
        "with %s, m as (select t.token_hash, t.origin_hash, t.created_at, t.superseded_at from public.auth_refresh_tokens t "
        "where (t.superseded_at is null or t.superseded_at > t.created_at) and t.created_at >= %s - interval '1 minute' and t.created_at < %s) "
        "select %s as day, s.profile_id in (select user_id from admins) as is_admin, count(*)::int as renewals, "
        "count(distinct m.origin_hash)::int as sign_ins, "
        "count(*) filter (where exists (select 1 from m m2 where m2.origin_hash = m.origin_hash and m2.token_hash <> m.token_hash "
        "and m2.created_at between m.created_at - interval '60 seconds' and m.created_at + interval '60 seconds'))::int as renewals_in_parallel, "
        "count(*) filter (where m.superseded_at is null and exists (select 1 from m m2 where m2.origin_hash = m.origin_hash "
        "and m2.created_at > m.created_at))::int as never_used_again "
        "from m join public.auth_sessions s on s.token_origin_hash = m.origin_hash where %s group by 1, 2 order by 1, 2"
    ) % (SESSION_ADMINS_SQL, a, b, day("m.created_at"), inside_real("m.created_at"))
    step_up = (
        "select kind, day, count(*)::int as n from ("
        "select case when succeeded then 'step_up_ok' else 'step_up_failed' end as kind, %s as day from public.admin_step_up_attempts where %s "
        "union all select action, %s from public.audit_events where action in ('account.mfa_reset', 'account.mfa_backup_code_used', "
        "'account.sessions_signed_out', 'account.password_changed') and %s"
        ") x group by 1, 2 order by 2, 1"
    ) % (day("created_at"), inside("created_at"), day("created_at"), inside("created_at"))
    admins = "with %s select count(*)::int as admins from admins" % SESSION_ADMINS_SQL
    return [started_ended, ends, restarted, renewals, step_up, admins]


def who(row):
    return "admin" if row.get("is_admin") in (True, "true", "t", 1) else "member"


def section_sessdb():
    out("=== SIGN-INS ACROSS DEVICES (owner 15 Nov): counts per UTC day, administrators apart; no member data ===")
    start, end = sessions_window()
    out("SESS_WINDOW", iso(start), iso(end))
    started_ended, ends, restarted, renewals, step_up, admins = sql_rows(session_statements(start, end))
    if admins is None:
        out("SESS UNAVAILABLE")
        return
    out("SESS_ADMINS", "count=%d" % int(admins[0]["admins"]))
    for r in started_ended or []:
        out("SESS_DAY", r["day"], r["kind"], who(r), r["detail"] or "none", "n=%d" % int(r["n"]))
    for r in ends or []:
        out("SESS_END", r["day"], who(r), r["reason"] or "none", "ended=%d" % int(r["ended"]),
            "other_device_active_near=%d" % int(r["other_device_active_near"]),
            "signed_in_again_30min=%d" % int(r["signed_in_again_30min"]), "had_parallel_renewal=%d" % int(r["had_parallel_renewal"]))
    for r in restarted or []:
        out("SESS_RESTART", r["day"], who(r), "sign_ins=%d" % int(r["sign_ins"]), "replaced_unended=%d" % int(r["replaced_unended"]),
            "replaced_after_other_device=%d" % int(r["replaced_after_other_device"]))
    for r in renewals or []:
        out("SESS_RENEW", r["day"], who(r), "renewals=%d" % int(r["renewals"]), "sign_ins=%d" % int(r["sign_ins"]),
            "renewals_in_parallel=%d" % int(r["renewals_in_parallel"]), "never_used_again=%d" % int(r["never_used_again"]))
    for r in step_up or []:
        out("SESS_SECURITY", r["day"], r["kind"], "n=%d" % int(r["n"]))


def section_sessmetric():
    out("=== REUSED SIGN-IN TOKENS PER UTC DAY (SeaNShore/App RefreshTokenReuse, by where it was caught; counts only) ===")
    start, end = sessions_window()
    first = start.replace(hour=0, minute=0)
    for source in ("cognito", "ledger"):
        q = [{"Id": "m", "MetricStat": {"Metric": {"Namespace": "SeaNShore/App", "MetricName": "RefreshTokenReuse",
              "Dimensions": [{"Name": "Area", "Value": "auth"}, {"Name": "Source", "Value": source}]},
              "Period": 86400, "Stat": "Sum"}, "ReturnData": True}]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(q, f)
            path = f.name
        try:
            data = aws("cloudwatch", "get-metric-data", "--start-time", iso(first), "--end-time", iso(end),
                       "--metric-data-queries", "file://" + path, "--scan-by", "TimestampAscending")
        finally:
            os.unlink(path)
        result = ((data or {}).get("MetricDataResults") or [{}])[0]
        pairs = list(zip(result.get("Timestamps", []), result.get("Values", [])))
        out("SESS_REUSE_METRIC", source, " ".join("%s=%d" % (t[:10], int(v)) for t, v in pairs) or "none")
    # The ledger cannot reach the database (logged by tag only), per day: a refresh then goes ahead unrecorded.
    day = first
    while day < end:
        nxt = day + dt.timedelta(days=1)
        n = aws("logs", "filter-log-events", "--log-group-name", "/ecs/%s/web" % PREFIX,
                "--start-time", int(day.timestamp() * 1000), "--end-time", int(min(nxt, end).timestamp() * 1000),
                "--filter-pattern", '"auth_refresh_ledger_unavailable"', "--query", "length(events)")
        out("SESS_LEDGER_UNAVAILABLE", day.date().isoformat(), "events=%s" % (n if n is not None else "UNAVAILABLE"))
        day = nxt


# Owner (18 Nov): the phone-and-laptop sign-outs left after the 15 Nov single-renewal fix. For every sign-in ended by a
# reused (stale) token in the sessions window: how long after its sign-in's last renewal the stale token came back,
# which request carried that last renewal and whether the viewer went away before its answer arrived (load balancer
# status 460, "client closed": the new token's cookie may never have reached the browser), which requests presented
# the stale token, and the device kind. Requests are matched to the database rows by time only (the load balancer
# sees CloudFront, not the member). Route shapes, kinds, statuses and counts only: no ids, tokens or addresses.
SESS_FIX_DEPLOYED = dt.datetime(2026, 11, 15, 12, 0, tzinfo=dt.timezone.utc)
STALE_AGE_BUCKETS = ((120, "under_2m"), (600, "2_10m"), (3600, "10_60m"), (6 * 3600, "1_6h"), (24 * 3600, "6_24h"))


def stale_age_bucket(seconds):
    if seconds is None:
        return "no_renewal_in_window"
    for limit, name in STALE_AGE_BUCKETS:
        if seconds < limit:
            return name
    return "over_24h"


def ua_kind(ua):
    """phone, tablet, computer or unknown, as src/features/account-security/user-agent.ts reads a User-Agent."""
    if re.search(r"\biPhone\b", ua) or (re.search(r"\bAndroid\b", ua) and re.search(r"\bMobile\b", ua)):
        return "phone"
    if re.search(r"\biPad\b|\bAndroid\b", ua):
        return "tablet"
    if re.search(r"\bCrOS\b|\bWindows\b|\bMacintosh\b|\bMac OS X\b|\bLinux\b", ua):
        return "computer"
    return "unknown"


def summary_kind(summary):
    """The device kind of a stored "Browser on Device" summary (deviceKindOfSummary), "app" for an installed app."""
    summary = summary or ""
    if re.search(r"Home Screen app|Installed app", summary):
        return "app"
    if re.search(r"iPhone|Android phone", summary):
        return "phone"
    if re.search(r"iPad|Android tablet", summary):
        return "tablet"
    if re.search(r"Windows|Mac|Linux|Chromebook", summary):
        return "computer"
    return "unknown"


def stale_period(t):
    return "after_fix" if t >= SESS_FIX_DEPLOYED else "before_fix"


def stale_statements(start, end):
    a, b = "timestamptz '%s'" % iso(start), "timestamptz '%s'" % iso(end)
    real = "join public.profiles p on p.id = s.profile_id and not p.is_load_test"
    rotations = ("select t.origin_hash, t.superseded_at as at from public.auth_refresh_tokens t "
                 "join public.auth_sessions s on s.token_origin_hash = t.origin_hash %s "
                 "where t.superseded_at is not null and t.superseded_at > t.created_at and t.superseded_at >= %s - interval '1 day' "
                 "and t.superseded_at < %s" % (real, a, b))
    ends = ("with %s select s.token_origin_hash as origin_hash, s.reuse_detected_at as at, s.user_agent_summary as summary, "
            "s.profile_id in (select user_id from admins) as is_admin from public.auth_sessions s %s "
            "where s.reuse_detected_at >= %s and s.reuse_detected_at < %s" % (SESSION_ADMINS_SQL, real, a, b))
    return [rotations, ends]


def section_sessstale():
    out("=== STALE SIGN-IN TOKENS: WHAT RENEWED THEM, WHAT PRESENTED THEM, HOW OLD (owner 18 Nov; counts only) ===")
    start, end = sessions_window()
    rows = sql_rows(stale_statements(start, end))
    if rows[0] is None or rows[1] is None:
        out("STALE UNAVAILABLE")
        return
    parse = lambda value: dt.datetime.fromisoformat(str(value).replace("Z", "+00:00").replace(" ", "T"))
    renewals = defaultdict(list)
    for r in rows[0]:
        renewals[r["origin_hash"]].append(parse(r["at"]))
    for times in renewals.values():
        times.sort()
    ends = [(parse(r["at"]), r["origin_hash"], summary_kind(r.get("summary")), bool(r.get("is_admin"))) for r in rows[1]]
    # The seconds the load balancer log is read for: each renewal and the 5 seconds after it (its answer), and 2
    # seconds either side of each sign-out (the request that presented the stale token).
    wanted = set()
    window_renewals = [t for times in renewals.values() for t in times if start <= t < end]
    for t in window_renewals:
        for d in range(0, 6):
            wanted.add((t + dt.timedelta(seconds=d)).strftime("%Y-%m-%dT%H:%M:%S"))
    for t, _o, _k, _a in ends:
        for d in range(-2, 3):
            wanted.add((t + dt.timedelta(seconds=d)).strftime("%Y-%m-%dT%H:%M:%S"))
    by_second = defaultdict(list)
    bot = re.compile(BOT_PATTERN, re.I)
    totals, budget = Counter(), {"bytes": 0}
    day = start.date()
    while day <= end.date():
        for line in alb_day_lines(day, totals, budget):
            m = LOG_LINE.match(line)
            if not m or m.group(2)[:19] not in wanted or bot.search(m.group(14)):
                continue
            request = m.group(13).split(" ")
            method = request[0] if request else "-"
            url = request[1] if len(request) > 1 else ""
            path = re.sub(r"^https?://[^/]+(:\d+)?", "", url).split("?")[0] or "/"
            query = url.split("?", 1)[1] if "?" in url else ""
            kind = cap_request_type(method, path, query, m.group(9))
            if kind in ("static", "image", "non_person"):
                continue
            by_second[m.group(2)[:19]].append((kind, route_shape(path), m.group(9), ua_kind(m.group(14))))
        day += dt.timedelta(days=1)
    out("STALE_ALB_LOGS", "scannedMB=%s" % mb(budget["bytes"]), "seconds_matched=%d" % len(by_second))

    def first_after(t, seconds):
        for d in range(0, seconds + 1):
            hit = by_second.get((t + dt.timedelta(seconds=d)).strftime("%Y-%m-%dT%H:%M:%S"))
            if hit:
                return hit[0]
        return None

    # Every renewal in the window: the request that carried it (the first logged within 5 seconds) and its status.
    renewal_counts = Counter()
    for t in window_renewals:
        hit = first_after(t, 5)
        if hit is None:
            renewal_counts[(stale_period(t), "unmatched", "-", "-", "-")] += 1
        else:
            renewal_counts[(stale_period(t),) + hit] += 1
    out("STALE_RENEWALS_TOTAL", "before_fix=%d" % sum(n for k, n in renewal_counts.items() if k[0] == "before_fix"),
        "after_fix=%d" % sum(n for k, n in renewal_counts.items() if k[0] == "after_fix"),
        "client_closed_460=%d" % sum(n for k, n in renewal_counts.items() if k[3] == "460"))
    for key, n in sorted(renewal_counts.items(), key=lambda kv: (kv[0][0], -kv[1]))[:40]:
        out("STALE_RENEWAL", "period=%s" % key[0], "kind=%s" % key[1], "route=%s" % key[2], "elb=%s" % key[3], "device=%s" % key[4], "n=%d" % n)
    # Every sign-out by a stale token: its age bucket, its device kind, admin or member, and its last renewal's request.
    end_counts, last_renewal, presented = Counter(), Counter(), Counter()
    for t, origin, kind, is_admin in ends:
        period = stale_period(t)
        before = [r for r in renewals.get(origin, []) if r <= t]
        last = before[-1] if before else None
        age = (t - last).total_seconds() if last else None
        who = "admin" if is_admin else "member"
        end_counts[(period, who, stale_age_bucket(age), kind)] += 1
        hit = first_after(last, 5) if last else None
        last_renewal[(period, who) + (hit if hit else ("unmatched", "-", "-", "-"))] += 1
        for d in range(-2, 3):
            for req in by_second.get((t + dt.timedelta(seconds=d)).strftime("%Y-%m-%dT%H:%M:%S"), []):
                presented[(period, req[0], req[1], req[2], req[3])] += 1
    out("STALE_ENDS_TOTAL", "before_fix=%d" % sum(1 for e in ends if e[0] < SESS_FIX_DEPLOYED), "after_fix=%d" % sum(1 for e in ends if e[0] >= SESS_FIX_DEPLOYED))
    for key, n in sorted(end_counts.items()):
        out("STALE_END", "period=%s" % key[0], "who=%s" % key[1], "age=%s" % key[2], "device=%s" % key[3], "n=%d" % n)
    for key, n in sorted(last_renewal.items(), key=lambda kv: (kv[0][0], kv[0][1], -kv[1])):
        out("STALE_END_LAST_RENEWAL", "period=%s" % key[0], "who=%s" % key[1], "kind=%s" % key[2], "route=%s" % key[3], "elb=%s" % key[4], "device=%s" % key[5], "n=%d" % n)
    for key, n in sorted(presented.items(), key=lambda kv: (kv[0][0], -kv[1]))[:40]:
        out("STALE_PRESENTED_NEAR_END", "period=%s" % key[0], "kind=%s" % key[1], "route=%s" % key[2], "elb=%s" % key[3], "device=%s" % key[4], "n=%d" % n)


def section_dbcompare():
    """Round DB (Option A, owner 12 Nov): database cost per request, before and after, the same hours 24 hours apart.
    Requests from the ALB; database time from Performance Insights; Aurora capacity and CPU from CloudWatch. Counts,
    seconds and statement shapes only."""
    windows, _split = compare_windows()
    out("=== DATABASE COST PER REQUEST, BEFORE AND AFTER (same hours, 24 hours apart) ===")
    resource = writer_resource()
    alb = [d for d in search_dims("AWS/ApplicationELB", "RequestCount", PREFIX + "-alb") if set(d) == {"LoadBalancer"}]
    results = {}
    for label, start, end in windows:
        seconds = (end - start).total_seconds()
        requests = sum(v for d in alb for _t, v in metric_points("AWS/ApplicationELB", "RequestCount", d, "Sum", 3600, start, end))
        dims = {"DBClusterIdentifier": CLUSTER_ID}
        acu = [v for _t, v in metric_points("AWS/RDS", "ServerlessDatabaseCapacity", dims, "Average", 3600, start, end)]
        cpu = [v for _t, v in metric_points("AWS/RDS", "CPUUtilization", dims, "Average", 3600, start, end)]
        db_s = None
        if resource:
            data = aws("pi", "get-resource-metrics", "--service-type", "RDS", "--identifier", resource, "--start-time", iso(start),
                       "--end-time", iso(end), "--period-in-seconds", "3600", "--metric-queries", '[{"Metric":"db.load.avg"}]') or {}
            points = [p["Value"] for m in data.get("MetricList", []) for p in m.get("DataPoints", []) if p.get("Value") is not None]
            db_s = sum(points) * 3600 if points else None
        acu_s = sum(acu) * 3600 if acu else None
        per_1k = lambda v: ("%.2f" % (1000 * v / requests)) if v is not None and requests else "n/a"
        results[label] = (requests, db_s, acu_s)
        out("COMPARE_DB", label, "requests=%d" % requests, "db_s=%s" % ("%.0f" % db_s if db_s is not None else "n/a"),
            "db_s_per_1k_requests=%s" % per_1k(db_s), "acu_hours=%s" % ("%.1f" % (acu_s / 3600) if acu_s is not None else "n/a"),
            "acu_s_per_1k_requests=%s" % per_1k(acu_s), "aurora_cpu_avg_pct=%s" % ("%.1f" % statistics.fmean(cpu) if cpu else "n/a"),
            "hours=%.1f" % (seconds / 3600))
        if resource:
            for rank, k in enumerate(pi_keys(resource, start, end, "db.sql_tokenized", 12, PI_WINDOW_STATS), 1):
                a = k.get("AdditionalMetrics") or {}
                calls_ps = a.get("db.sql_tokenized.stats.calls_per_sec.avg")
                ms = a.get("db.sql_tokenized.stats.avg_latency_per_call.avg")
                out("COMPARE_DB_SQL", label, "rank=%d" % rank, "db_s=%.0f" % (k.get("Total", 0) * seconds),
                    "calls=%s" % ("%.0f" % (calls_ps * seconds) if isinstance(calls_ps, (int, float)) else "n/a"),
                    "ms_per_call=%s" % ("%.2f" % ms if isinstance(ms, (int, float)) else "n/a"),
                    "sql=" + one_line((k.get("Dimensions") or {}).get("db.sql_tokenized.statement", ""), 160))
    (rb, db_b, acu_b), (ra, db_a, acu_a) = results["before"], results["after"]
    ratio_of = lambda b, a: change(1000 * b / rb, 1000 * a / ra) if None not in (b, a) and rb and ra else "n/a"
    out("COMPARE_DB_CHANGE", "requests", change(rb, ra), "db_s_per_1k_requests", ratio_of(db_b, db_a),
        "acu_s_per_1k_requests", ratio_of(acu_b, acu_a))


# ---------------------------------------------------------------- Round CAP Step 0 (owner 13 Nov): read-only evidence

# The signed-in-only page prefixes, as in src/lib/auth/cognito-proxy.ts PROTECTED_PREFIXES (a contract test keeps them
# equal).
CAP_PROTECTED_PREFIXES = ("/activities", "/admin", "/community", "/events", "/hashtags", "/help/requests", "/hiring", "/home",
                          "/jobs", "/learn", "/messages", "/network", "/notifications", "/onboarding", "/profile", "/saved",
                          "/search")
# Real-traffic windows only: the load tests are left out of every Step 0 figure. Their requests carry the load test's
# agent and their members are load-test profiles, but Performance Insights cannot tell them apart, so every load test
# run longer than three minutes since 7 Nov (aws-load-test.yml) is cut out, five minutes either side.
CAP_EXCLUDED = (("2026-11-07T10:45:00", "2026-11-07T11:30:00"), ("2026-11-08T12:05:00", "2026-11-08T12:20:00"),
                ("2026-11-08T13:45:00", "2026-11-08T14:00:00"), ("2026-11-09T11:15:00", "2026-11-09T11:40:00"),
                ("2026-11-11T09:15:00", "2026-11-11T09:30:00"), ("2026-11-11T10:30:00", "2026-11-11T11:05:00"),
                ("2026-11-11T19:50:00", "2026-11-11T21:05:00"), ("2026-11-12T11:15:00", "2026-11-12T12:00:00"))
CAP_HOME_PATH = "/home"
CAP_NON_PERSON = re.compile(r"^/api/(health(/|$)|.*/webhook$)")
CAP_API_KINDS = (("/api/feed/impressions", "impressions"), ("/api/metrics/visit", "visit_metric"), ("/api/realtime/ticket", "realtime_ticket"),
                 ("/api/realtime/", "realtime_other"), ("/api/media/", "media_api"), ("/api/feed-media/", "media_api"),
                 ("/api/community-media/", "media_api"), ("/api/learning-media/", "media_api"))


def cap_window():
    start, end = parse_minute(os.environ["CAP_START"]), parse_minute(os.environ["CAP_END"])
    assert start < end <= start + dt.timedelta(days=14), "the cap window must be at most 14 days"
    return start, end


def cap_excluded(t19):
    return any(a <= t19 < b for a, b in CAP_EXCLUDED)


def cap_request_type(method, path, query, status):
    """One request's type for the per-person rates: page, rsc (navigation or prefetch), rsc_hash_redirect (307 to the
    right _rsc), action, the named API kinds, other_api, image, static."""
    if STATIC.search(path):
        return "static"
    if path.startswith("/_next/image"):
        return "image"
    if "_rsc=" in query:
        return "rsc_hash_redirect" if status == "307" else "rsc"
    if path.startswith("/api/"):
        # Owner (13 Nov): machine traffic is never counted per person (Resend, payment and payout webhooks, health checks).
        if CAP_NON_PERSON.search(path):
            return "non_person"
        for prefix, kind in CAP_API_KINDS:
            if path.startswith(prefix):
                return kind
        return "other_api"
    if method == "POST":
        return "action"
    return "page"


def cap_protected(path):
    return any(path == p or path.startswith(p + "/") for p in CAP_PROTECTED_PREFIXES)


# Signed-in activity a member leaves in the database, as (table, member column, time column). The load balancer only
# sees CloudFront's addresses (the origin is locked to CloudFront), so its logs cannot tell one browser from another;
# a member counts as active in a minute when one of these rows was written in that minute. That misses minutes spent
# only reading, so the person-minutes are a floor and the requests per person-minute an upper bound.
CAP_ACTIVITY = [
    ("public.post_impressions", "viewer_id", "first_seen_at"),
    ("public.post_impressions", "viewer_id", "last_seen_at"),
    ("public.post_reactions", "user_id", "created_at"),
    ("public.post_comments", "author_id", "created_at"),
    ("public.comment_reactions", "user_id", "created_at"),
    ("public.messages", "sender_profile_id", "created_at"),
    ("public.conversation_participants", "profile_id", "last_read_at"),
    ("public.notifications", "recipient_id", "read_at"),
    ("public.saved_posts", "user_id", "created_at"),
    ("public.search_queries", "viewer_id", "created_at"),
    ("public.follows", "follower_id", "created_at"),
]


def cap_activity_sql(start, end):
    """Per hour of the window: signed-in person-minutes (distinct member and minute), the busiest minute and distinct
    members, real members only. Counts only."""
    excluded = lambda col: " ".join("and not (%s >= timestamptz '%sZ' and %s < timestamptz '%sZ')" % (col, a, col, b) for a, b in CAP_EXCLUDED)
    parts = ["select %s as member, date_trunc('minute', %s) as minute from %s where %s >= timestamptz '%s' and %s < timestamptz '%s' %s"
             % (member, col, table, col, iso(start), col, iso(end), excluded(col)) for table, member, col in CAP_ACTIVITY]
    return ("with activity as (" + " union ".join(parts) + "), real as (select a.member, a.minute from activity a "
            "join public.profiles p on p.id = a.member where not p.is_load_test), per_minute as (select minute, "
            "count(*)::int as people from real group by minute) select floor(extract(epoch from (minute - timestamptz '%s')) / 3600)::int as h, "
            "sum(people)::int as person_minutes, max(people)::int as peak_minute, count(*)::int as minutes_with_any "
            "from per_minute group by 1 order by 1" % iso(start),
            "with activity as (" + " union ".join(parts) + ") select count(distinct a.member)::int as members from activity a "
            "join public.profiles p on p.id = a.member where not p.is_load_test")


def section_capminutes():
    out("=== ROUND CAP STEP 0: REQUESTS PER ACTIVE SIGNED-IN PERSON-MINUTE BY TYPE (counts only) ===")
    start, end = cap_window()
    hours = int((end - start).total_seconds() // 3600) + 1
    out("CAP_WINDOW", iso(start), iso(end), "excluded_load_tests=%s" % ",".join("%s..%s" % w for w in CAP_EXCLUDED))
    bot = re.compile(BOT_PATTERN, re.I)
    totals, budget = Counter(), {"bytes": 0}
    hourly = [Counter() for _ in range(hours)]
    routes = defaultdict(Counter)
    day = start.date()
    while day <= end.date():
        for line in alb_day_lines(day, totals, budget):
            m = LOG_LINE.match(line)
            if not m:
                continue
            t19 = m.group(2)[:19]
            if not (iso(start)[:19] <= t19 < iso(end)[:19]):
                continue
            if cap_excluded(t19):
                totals["excluded_load_test_window"] += 1
                continue
            if bot.search(m.group(14)):
                totals["bot_or_probe"] += 1
                continue
            request = m.group(13).split(" ")
            method = request[0] if request else "-"
            url = request[1] if len(request) > 1 else ""
            path = re.sub(r"^https?://[^/]+(:\d+)?", "", url).split("?")[0] or "/"
            query = url.split("?", 1)[1] if "?" in url else ""
            kind = cap_request_type(method, path, query, m.group(9))
            # Owner (14 Nov): the home feed (/home pages, navigations and its Server Actions, such as "load more") is
            # its own type, so its share of signed-in requests shows next to everything else.
            if path == CAP_HOME_PATH and kind in ("page", "rsc", "action"):
                kind = "home_" + kind
            # Pages and RSC payloads split by whether the route needs a signed-in member.
            elif kind in ("page", "rsc"):
                kind += "_signed_in_route" if cap_protected(path) else "_public_route"
            t = dt.datetime.strptime(t19, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc)
            hourly[int((t - start).total_seconds() // 3600)][kind] += 1
            totals[kind] += 1
            if kind in ("action", "other_api") or kind.startswith("rsc_"):
                routes[kind][route_shape(path)] += 1
        day += dt.timedelta(days=1)
    out("CAP_ALB_LOGS", "scannedMB=%s" % mb(budget["bytes"]), json.dumps(dict(totals), sort_keys=True))
    per_hour, members = sql_rows(list(cap_activity_sql(start, end)))
    if per_hour is None:
        out("CAP_PERSON_MINUTES UNAVAILABLE")
        return
    activity = {int(r["h"]): r for r in per_hour}
    person_minutes = sum(int(r["person_minutes"]) for r in per_hour)
    out("CAP_PERSON_MINUTES", "total=%d" % person_minutes, "distinct_members=%s" % (members or [{}])[0].get("members"),
        "busiest_minute_people=%d" % max([int(r["peak_minute"]) for r in per_hour] or [0]),
        "hours_with_any=%d" % len(activity), "floor_only=true")
    # Signed-in traffic is what the signed-in people send: everything but public pages, public RSC and static files.
    signed_in_kinds = sorted({k for c in hourly for k in c} - {"page_public_route", "rsc_public_route", "static", "non_person"})

    def rates(label, chosen):
        minutes = sum(int(activity[h]["person_minutes"]) for h in chosen if h in activity)
        sums = Counter()
        for h in chosen:
            sums.update({k: v for k, v in hourly[h].items() if k in signed_in_kinds})
        total = sum(sums.values())
        out("CAP_RATE_TOTAL", label, "person_minutes=%d" % minutes, "signed_in_requests=%d" % total,
            "per_person_minute=%s" % (("%.2f" % (total / minutes)) if minutes else "n/a"))
        for kind in signed_in_kinds:
            out("CAP_RATE", label, kind, "requests=%d" % sums[kind],
                "per_person_minute=%s" % (("%.3f" % (sums[kind] / minutes)) if minutes else "n/a"))

    rates("whole_window", range(hours))
    # The busiest hours (by person-minutes) are nearest to "many people online at once".
    busiest = sorted(activity, key=lambda h: -int(activity[h]["person_minutes"]))[:24]
    rates("busiest_24_hours", busiest)
    for h in sorted(busiest, key=lambda h: -int(activity[h]["person_minutes"]))[:10]:
        a, c = activity[h], hourly[h]
        out("CAP_BUSY_HOUR", (start + dt.timedelta(hours=h)).strftime("%dT%H:00"), "person_minutes=%s" % a["person_minutes"],
            "peak_minute_people=%s" % a["peak_minute"], "signed_in_requests=%d" % sum(v for k, v in c.items() if k in signed_in_kinds),
            " ".join("%s=%d" % (k, c[k]) for k in signed_in_kinds if c[k]))
    home = [k for k in signed_in_kinds if k.startswith("home_")]
    all_signed_in = sum(totals[k] for k in signed_in_kinds)
    out("CAP_HOME_SHARE", "home_requests=%d" % sum(totals[k] for k in home), "signed_in_requests=%d" % all_signed_in,
        "share=%s" % (("%.0f%%" % (100 * sum(totals[k] for k in home) / all_signed_in)) if all_signed_in else "n/a"),
        " ".join("%s=%d" % (k, totals[k]) for k in home) or "none")
    for kind in ("action", "other_api", "rsc_signed_in_route", "rsc_public_route"):
        out("CAP_TOP_ROUTES", kind, " ".join("%s=%d" % kv for kv in routes[kind].most_common(15)) or "none")


# Writes: rows written in the window per table (counts), and the write statements by calls since the statistics reset.
CAP_WRITE_COUNTS = [
    ("post_impressions_new", "public.post_impressions", "first_seen_at"),
    ("post_impressions_seen_again", "public.post_impressions", "last_seen_at"),
    ("feed_sessions", "public.feed_sessions", "created_at"),
    ("post_reactions", "public.post_reactions", "created_at"),
    ("post_comments", "public.post_comments", "created_at"),
    ("posts", "public.posts", "created_at"),
    ("messages", "public.messages", "created_at"),
    ("notifications_created", "public.notifications", "created_at"),
    ("notifications_read", "public.notifications", "read_at"),
    ("follows", "public.follows", "created_at"),
    ("connections", "public.connections", "updated_at"),
    ("social_action_events", "public.social_action_events", "created_at"),
    ("auth_sessions_seen", "public.auth_sessions", "last_seen_at"),
    ("saved_posts", "public.saved_posts", "created_at"),
    ("comment_reactions", "public.comment_reactions", "created_at"),
    ("message_reactions", "public.message_reactions", "created_at"),
    ("conversations_read", "public.conversation_participants", "last_read_at"),
    ("post_stats_updated", "public.post_stats", "updated_at"),
    ("people_suggestions_computed", "public.people_suggestions", "computed_at"),
    ("search_queries", "public.search_queries", "created_at"),
]
# Rows whose newest write fell in the window (a row written twice counts once): a floor for the writes, not every write.


def section_capwrites():
    out("=== ROUND CAP STEP 0: WRITES IN THE WINDOW (counts only) ===")
    start, end = cap_window()
    days = (end - start).total_seconds() / 86400
    for label, table, column in CAP_WRITE_COUNTS:
        excluded = " ".join("and not (%s >= timestamptz '%sZ' and %s < timestamptz '%sZ')" % (column, a, column, b) for a, b in CAP_EXCLUDED)
        rows = sql_rows(["select count(*)::bigint as n from %s where %s >= timestamptz '%s' and %s < timestamptz '%s' %s"
                         % (table, column, iso(start), column, iso(end), excluded)])[0]
        if rows is None:
            out("CAP_WRITES", label, "UNAVAILABLE")
            continue
        n = int(rows[0]["n"])
        out("CAP_WRITES", label, "rows=%d" % n, "per_day=%.0f" % (n / days if days else 0))
    since, writes = sql_rows([
        "select stats_reset::text as since, extract(epoch from (now() - stats_reset))::bigint as seconds from pg_stat_statements_info",
        "select queryid::text as id, calls::bigint as calls, round(total_exec_time::numeric / 1000, 1) as total_s, "
        "round(mean_exec_time::numeric, 2) as mean_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 200) as q from pg_stat_statements "
        "where query ~* '^\\s*(insert|update|delete)\\y' order by calls desc limit 20",
    ])
    seconds = int((since or [{}])[0].get("seconds") or 0)
    out("CAP_WRITE_STATEMENTS_SINCE", (since or [{}])[0].get("since"), "days=%.1f" % (seconds / 86400))
    for rank, row in enumerate(writes or [], 1):
        q = row.pop("q", "")
        out("CAP_WRITE_STATEMENT", "rank=%d" % rank, "calls=%s" % row["calls"],
            "per_day=%.0f" % (int(row["calls"]) / (seconds / 86400)) if seconds else "per_day=n/a",
            "total_s=%s" % row["total_s"], "mean_ms=%s" % row["mean_ms"], "sql=" + one_line(q, 200))


# Owner (14 Nov): which part of the product each top statement serves, from the tables it names (first rule that
# matches). The home feed is the candidate, ranking and impression work; other post reads (a post page, a profile's
# posts, a community) are "posts_other".
CAP_AREAS = (
    ("home_feed", ("post_impressions", "feed_sessions", "feed_feedback", "post_hides", "post_engagement_counters", "post_stats")),
    ("notifications", ("public.notifications", "notification_")),
    ("messages", ("public.messages", "conversation_participants", "public.conversations")),
    ("jobs", ("public.jobs", "job_applications", "job_saves", "job_department_extra_ranks")),
    ("people", ("public.connections", "public.follows", "suggestion_dismissals", "people_")),
    ("posts_other", ("public.posts", "post_comments", "post_reactions")),
    ("communities", ("community_",)),
    ("learning", ("learning_", "public.courses")),
    ("auth_session", ("identity_", "device_sessions", "auth_", "sessions")),
)


def cap_area(sql):
    text = sql.lower()
    for area, needles in CAP_AREAS:
        if any(n in text for n in needles):
            return area
    return "other"


def section_cap7d():
    out("=== ROUND CAP STEP 0: TOP STATEMENTS OVER THE LAST 7 DAYS OF REAL TRAFFIC (load tests left out) ===")
    resource = writer_resource()
    if not resource:
        out("PI UNAVAILABLE")
        return
    # The cap window, inside the 7 days Performance Insights keeps.
    window_start, end = cap_window()
    start = max(window_start, NOW - dt.timedelta(days=7) + dt.timedelta(minutes=5))
    # Real-traffic ranges: the 7 days minus the load test windows.
    cuts = sorted((parse_minute(a + "Z"), parse_minute(b + "Z")) for a, b in CAP_EXCLUDED)
    ranges, cursor = [], start
    for a, b in cuts:
        if b <= cursor or a >= end:
            continue
        if a > cursor:
            ranges.append((cursor, a))
        cursor = max(cursor, b)
    if cursor < end:
        ranges.append((cursor, end))
    total_s = sum((b - a).total_seconds() for a, b in ranges)
    out("CAP_7D_RANGES", " ".join("%s..%s" % (iso(a), iso(b)) for a, b in ranges), "hours=%.1f" % (total_s / 3600))
    merged = {}
    for a, b in ranges:
        seconds = (b - a).total_seconds()
        for k in pi_keys(resource, a, b, "db.sql_tokenized", 25, PI_WINDOW_STATS):
            d = k.get("Dimensions") or {}
            sql_id = d.get("db.sql_tokenized.id") or d.get("db.sql_tokenized.statement", "")[:80]
            m = merged.setdefault(sql_id, {"db_s": 0.0, "calls": 0.0, "ms_weighted": 0.0, "sql": one_line(d.get("db.sql_tokenized.statement", ""), 200),
                                           "area": cap_area(d.get("db.sql_tokenized.statement", ""))})
            m["db_s"] += k.get("Total", 0) * seconds
            add = k.get("AdditionalMetrics") or {}
            calls_ps, ms = add.get("db.sql_tokenized.stats.calls_per_sec.avg"), add.get("db.sql_tokenized.stats.avg_latency_per_call.avg")
            if isinstance(calls_ps, (int, float)):
                m["calls"] += calls_ps * seconds
                if isinstance(ms, (int, float)):
                    m["ms_weighted"] += ms * calls_ps * seconds
    ranked = sorted(merged.values(), key=lambda m: -m["db_s"])
    total_db = sum(m["db_s"] for m in ranked) or 1
    out("CAP_7D_TOP5_SHARE", "%.0f%%" % (100 * sum(m["db_s"] for m in ranked[:5]) / total_db), "of_listed_db_s=%.0f" % total_db)
    for rank, m in enumerate(ranked[:25], 1):
        out("CAP_7D_SQL", "rank=%d" % rank, "db_s=%.0f" % m["db_s"], "share=%.0f%%" % (100 * m["db_s"] / total_db),
            "calls=%.0f" % m["calls"], "ms_per_call=%s" % (("%.2f" % (m["ms_weighted"] / m["calls"])) if m["calls"] else "n/a"),
            "area=" + m["area"], "sql=" + m["sql"])
    areas = defaultdict(lambda: {"db_s": 0.0, "calls": 0.0})
    for m in ranked:
        areas[m["area"]]["db_s"] += m["db_s"]
        areas[m["area"]]["calls"] += m["calls"]
    for area, a in sorted(areas.items(), key=lambda kv: -kv[1]["db_s"]):
        out("CAP_7D_AREA", area, "db_s=%.0f" % a["db_s"], "share=%.0f%%" % (100 * a["db_s"] / total_db), "calls=%.0f" % a["calls"])
    by_calls = sorted(ranked, key=lambda m: -m["calls"])[:10]
    out("CAP_7D_BY_CALLS", " | ".join("calls=%.0f ms=%s sql=%s" % (m["calls"], ("%.2f" % (m["ms_weighted"] / m["calls"])) if m["calls"] else "n/a", m["sql"][:70]) for m in by_calls))


# ---------------------------------------------------------------- Round CAP: the admin final-reminder counts, split

# Owner (13 Nov): split the admin legacy-invites counts at the Round DB Deploy B deploy, with calls and ms per call
# before and after, and check whether the page refreshes by itself. "legacy <start> <deploy B> <time limit> <end>": the
# second split is when the app role's 10-second statement limit reached every connection (the Deploy C deploy).
LEGACY_TABLES = ("legacy_profile_invites", "legacy_profile_invite_reminders", "legacy_profile_invite_final_reminders",
                 "legacy_profile_claims", "identity_accounts", "email_delivery_events", "email_suppressions",
                 "newsletter_subscribers")


def legacy_ranges():
    points = [parse_minute(v) for v in os.environ["LEGACY_POINTS"].split(",")]
    assert len(points) == 4 and points == sorted(points), "the legacy window needs start < deploy B < time limit < end"
    points[0] = max(points[0], NOW - dt.timedelta(days=7) + dt.timedelta(minutes=5))
    return [("before_deploy_b", points[0], points[1]), ("deploy_b_no_time_limit", points[1], points[2]),
            ("with_10s_limit", points[2], points[3])]


def legacy_kind(sql):
    text = sql.lower()
    if "legacy_profile_invite" not in text and "legacy_profile_claims" not in text:
        return None
    if text.startswith("select reason, count(*)"):
        return "final_counts" if "legacy_profile_invite_final_reminders" in text else "reminder_counts"
    if text.startswith("with eligible as"):
        return "final_prepare"
    return "other_legacy"


def without_load_tests(start, end):
    """[start, end) less the load test windows, as ranges."""
    ranges, cursor = [], start
    for a, b in sorted((parse_minute(a + "Z"), parse_minute(b + "Z")) for a, b in CAP_EXCLUDED):
        if b <= cursor or a >= end:
            continue
        if a > cursor:
            ranges.append((cursor, a))
        cursor = max(cursor, b)
    if cursor < end:
        ranges.append((cursor, end))
    return ranges


def legacy_pi(resource, start, end):
    """Per statement kind over [start, end): database seconds, calls and ms per call (Performance Insights)."""
    kinds = defaultdict(lambda: {"db_s": 0.0, "calls": 0.0, "ms_weighted": 0.0, "shapes": set()})
    for a, b in without_load_tests(start, end):
        seconds = (b - a).total_seconds()
        for k in pi_keys(resource, a, b, "db.sql_tokenized", 25, PI_WINDOW_STATS):
            d = k.get("Dimensions") or {}
            kind = legacy_kind(d.get("db.sql_tokenized.statement", ""))
            if not kind:
                continue
            m = kinds[kind]
            m["db_s"] += k.get("Total", 0) * seconds
            m["shapes"].add(d.get("db.sql_tokenized.id") or "?")
            add = k.get("AdditionalMetrics") or {}
            calls_ps, ms = add.get("db.sql_tokenized.stats.calls_per_sec.avg"), add.get("db.sql_tokenized.stats.avg_latency_per_call.avg")
            if isinstance(calls_ps, (int, float)):
                m["calls"] += calls_ps * seconds
                if isinstance(ms, (int, float)):
                    m["ms_weighted"] += ms * calls_ps * seconds
    return kinds


def section_legacysplit():
    out("=== ROUND CAP: ADMIN FINAL-REMINDER COUNTS BEFORE AND AFTER DEPLOY B (shapes and counts only) ===")
    ranges = legacy_ranges()
    for label, a, b in ranges:
        out("LEGACY_RANGE", label, iso(a), iso(b), "hours=%.1f" % ((b - a).total_seconds() / 3600))
    resource = writer_resource()
    if resource:
        for label, a, b in ranges:
            for kind, m in sorted(legacy_pi(resource, a, b).items()):
                out("LEGACY_PI", label, kind, "db_s=%.0f" % m["db_s"], "calls=%.0f" % m["calls"],
                    "ms_per_call=%s" % (("%.0f" % (m["ms_weighted"] / m["calls"])) if m["calls"] else "n/a"),
                    "statement_shapes=%d" % len(m["shapes"]))
        # Per day, so a pattern (one admin session a day, or many) shows.
        day = ranges[0][1].replace(hour=0, minute=0)
        while day < ranges[-1][2]:
            a, b = max(day, ranges[0][1]), min(day + dt.timedelta(days=1), ranges[-1][2])
            for kind, m in sorted(legacy_pi(resource, a, b).items()):
                if kind.endswith("_counts"):
                    out("LEGACY_PI_DAY", a.strftime("%m-%d"), kind, "db_s=%.0f" % m["db_s"], "calls=%.0f" % m["calls"],
                        "ms_per_call=%s" % (("%.0f" % (m["ms_weighted"] / m["calls"])) if m["calls"] else "n/a"))
            day += dt.timedelta(days=1)
    else:
        out("PI UNAVAILABLE")
    # pg_stat_statements since its reset: completed calls only (a statement cancelled by the time limit is not counted).
    stats, counts = sql_rows([
        "select calls::bigint as calls, round(total_exec_time::numeric / 1000, 1) as total_s, round(mean_exec_time::numeric) as mean_ms, "
        "round(min_exec_time::numeric) as min_ms, round(max_exec_time::numeric) as max_ms, rows::bigint as rows, "
        "left(regexp_replace(query, '\\s+', ' ', 'g'), 300) as q from pg_stat_statements "
        "where query ilike '%legacy_profile_invite%' order by total_exec_time desc limit 10",
        "select " + ", ".join("(select count(*) from public.%s)::bigint as %s" % (t, t) for t in LEGACY_TABLES),
    ])
    for row in stats or []:
        out("LEGACY_STATEMENT", legacy_kind(row.get("q", "")) or "other", "calls=%s" % row["calls"], "total_s=%s" % row["total_s"],
            "mean_ms=%s" % row["mean_ms"], "min_ms=%s" % row["min_ms"], "max_ms=%s" % row["max_ms"], "rows=%s" % row["rows"])
    out("LEGACY_ROWS", json.dumps((counts or [{}])[0], sort_keys=True))
    # The admin page in the load balancer logs: requests by kind, tab and status, server time, and the gaps between
    # requests (a page that refreshes by itself shows a fixed gap).
    bot = re.compile(BOT_PATTERN, re.I)
    kinds = {label: Counter() for label, _a, _b in ranges}
    times = {label: defaultdict(list) for label, _a, _b in ranges}
    stamps = []
    totals, budget = Counter(), {"bytes": 0}
    day = ranges[0][1].date()
    while day <= ranges[-1][2].date():
        for line in alb_day_lines(day, totals, budget):
            m = LOG_LINE.match(line)
            if not m or bot.search(m.group(14)):
                continue
            request = m.group(13).split(" ")
            url = request[1] if len(request) > 1 else ""
            path = re.sub(r"^https?://[^/]+(:\d+)?", "", url).split("?")[0]
            if path != "/admin/legacy-invites":
                continue
            t19 = m.group(2)[:19]
            t = dt.datetime.strptime(t19, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc)
            label = next((l for l, a, b in ranges if a <= t < b), None)
            if not label:
                continue
            query = url.split("?", 1)[1] if "?" in url else ""
            tab = re.search(r"(?:^|&)mode=(final|reminder)", query)
            tab = tab.group(1) if tab else "first"
            kind = "action" if request[0] == "POST" else ("rsc" if "_rsc=" in query else "page")
            kinds[label]["%s:%s elb=%s target=%s" % (tab, kind, m.group(9), m.group(10))] += 1
            try:
                times[label][tab + ":" + kind].append(float(m.group(7)))
            except ValueError:
                pass
            if kind != "action":
                stamps.append(t)
        day += dt.timedelta(days=1)
    for label, _a, _b in ranges:
        out("LEGACY_ALB", label, " ".join("%s=%d" % kv for kv in sorted(kinds[label].items())) or "none")
        for key, values in sorted(times[label].items()):
            values = [v for v in values if v >= 0]
            if values:
                out("LEGACY_ALB_SERVER_S", label, key, "n=%d" % len(values), "p50=%.2f" % pct(values, 50),
                    "p90=%.2f" % pct(values, 90), "max=%.2f" % max(values))
    stamps.sort()
    gaps = Counter()
    for a, b in zip(stamps, stamps[1:]):
        s = (b - a).total_seconds()
        gaps["<10s" if s < 10 else "10-60s" if s < 60 else "1-5min" if s < 300 else "5-30min" if s < 1800 else ">30min"] += 1
    out("LEGACY_ALB_GAPS", "views=%d" % len(stamps), json.dumps(dict(gaps), sort_keys=True))
    # Statement timeouts in the web task's log, per range (counts only; no message is printed).
    for label, a, b in ranges:
        n = aws("logs", "filter-log-events", "--log-group-name", "/ecs/%s/web" % PREFIX,
                "--start-time", int(a.timestamp() * 1000), "--end-time", int(b.timestamp() * 1000),
                "--filter-pattern", '"statement timeout"', "--query", "length(events)")
        out("LEGACY_WEB_STATEMENT_TIMEOUTS", label, "events=%s" % (n if n is not None else "UNAVAILABLE"))


# ---------------------------------------------------------------- section: checks

# Round ARCH (Phase 2): read-only pre-check before the deploy arm (window file "checks"), counts and yes/no only.
# The live edge check (scripts/aws/org-page-edge-check.sh) probes the organization named exactly as in
# scripts/aws/org-page-probe-name.txt; the check passes only if exactly one organization has that name and it is
# public by the app's exact rule (organizationPubliclyVisibleSql: claimed, and listable as in listableOrganizationSql).
CLAIM_STATUS_SQL = "coalesce(to_jsonb(company) ->> 'claim_status', 'claimed')"
LISTABLE_SQL = (
    "((" + CLAIM_STATUS_SQL + " = 'unclaimed' and not exists (select 1 from public.organization_applications a "
    "where a.company_id = company.id and a.status = 'suspended')) or ((coalesce(company.is_verified, false) or not exists "
    "(select 1 from public.organization_applications a where a.company_id = company.id)) and not exists "
    "(select 1 from public.organization_applications a where a.company_id = company.id and a.status <> 'approved')))"
)


def section_checks():
    out("=== CHECKS (read-only, counts only) ===")
    name = os.environ.get("REPORT_PROBE_ORG_NAME", "")
    assert name and len(name) <= 120 and '"' not in name and "\\" not in name, "REPORT_PROBE_ORG_NAME must be one organization name"
    literal = "'" + name.replace("'", "''") + "'"
    rows = sql_rows([
        "select " + CLAIM_STATUS_SQL + " = 'claimed' as claimed, coalesce(company.is_verified, false) as verified, "
        + LISTABLE_SQL + " as listable, "
        "(select count(*) from public.organization_applications a where a.company_id = company.id and a.status <> 'approved')::int "
        "as open_applications from public.companies company where btrim(company.name) = " + literal,
    ])
    matches = rows[0]
    if matches is None:
        out("CHECK_PROBE_ORG", "UNAVAILABLE")
        return
    for r in matches:
        out("CHECK_PROBE_ORG_MATCH", "claimed=%s" % r.get("claimed"), "verified=%s" % r.get("verified"),
            "listable=%s" % r.get("listable"), "open_applications=%s" % r.get("open_applications"))
    public = len(matches) == 1 and bool(matches[0].get("claimed")) and bool(matches[0].get("listable"))
    verified = len(matches) == 1 and bool(matches[0].get("verified"))
    out("CHECK_PROBE_ORG", "matches=%d" % len(matches), "verified=%s" % verified, "public_by_app_rule=%s" % public)


# ---------------------------------------------------------------- section: media

# Fixed words that may appear in object keys (folders and file-name prefixes the app writes). Anything else,
# including every id, slug and member-chosen file name, prints as "*".
KEY_WORDS = frozenset("""
avatar avatars banner banners cover covers logo logos icon icons photo photos image images media video videos poster
posters thumbnail thumbnails trailer trailers document documents pdf attachment attachments file files original
originals cv cvs resume certificate certificates invoice invoices seller-invoices credit-notes receipts verification
verifications private public profiles profile organizations organization companies company communities community
community-media groups posts post feed feed-media events event learning learning-media courses course lessons lesson
materials scorm packages assignments assignment-attachments submissions messages message conversations jobs job
applications share-image og-image share dg-profile documents uploads tmp private-migrations legacy imports exports
account-export backups tax gst tds payouts lut job-applications profile-documents scorm_content certificate_logo
certificate_signature course_thumbnail course_trailer lesson_audio lesson_caption lesson_document lesson_image
lesson_resource lesson_video scorm_package session_recording assignment-submissions about site-settings
""".split())


def shape_key(key):
    parts = key.split("/")
    folders = ["%s" % p.lower() if p.lower() in KEY_WORDS else "*" for p in parts[:-1][:5]]
    name = parts[-1].lower()
    ext = name.rsplit(".", 1)[1][:6] if "." in name and re.match(r"^[a-z0-9]{1,6}$", name.rsplit(".", 1)[1]) else "-"
    first = re.split(r"[^a-z]+", name.rsplit(".", 1)[0])[0] if name else ""
    stem = "poster" if ".poster." in name else first if first in KEY_WORDS else "*"
    return "/".join(folders + [stem + "." + ext])


def section_media():
    out("=== C MEDIA STORED (counts and sizes only) ===")
    for b in ("media", "private"):
        bucket = "%s-%s-%s" % (PREFIX, ACCOUNT, b)
        for storage in ("StandardStorage",):
            size = metric_series("AWS/S3", "BucketSizeBytes", {"BucketName": bucket, "StorageType": storage}, "Average", 86400,
                                 start=NOW - dt.timedelta(days=3))
            out("S3_SIZE", b, storage, "GB=%s" % (round(size[-1] / 1024 ** 3, 3) if size else "NO_DATA"))
        listing = aws("s3api", "list-objects-v2", "--bucket", bucket) or {}
        groups = defaultdict(list)
        months = defaultdict(lambda: Counter())
        for obj in listing.get("Contents", []):
            k = shape_key(obj["Key"])
            groups[k].append(obj["Size"])
            months[k][obj["LastModified"][:7]] += obj["Size"]
        total = sum(sum(v) for v in groups.values())
        out("S3_LISTING", b, "objects=%d" % sum(len(v) for v in groups.values()), "GB=%.3f" % (total / 1024 ** 3), "shapes=%d" % len(groups))
        for k, sizes in sorted(groups.items(), key=lambda kv: -sum(kv[1]))[:30]:
            recent = months[k]
            last = sorted(recent.items())[-3:]
            out("S3_KIND", b, k, "n=%d" % len(sizes), "avgKB=%.0f" % (statistics.fmean(sizes) / 1024),
                "p95KB=%.0f" % (pct(sizes, 95) / 1024), "maxMB=%.2f" % mb(max(sizes)), "totalMB=%.1f" % mb(sum(sizes)),
                "byMonthMB=%s" % ",".join("%s:%.1f" % (m, v / 1048576) for m, v in last))
    for dims in search_dims("AWS/CloudFront", "BytesDownloaded", "", region=EDGE):
        if dims.get("Region") == "Global":
            month = metric_series("AWS/CloudFront", "BytesDownloaded", dims, "Sum", 86400, region=EDGE, start=NOW - dt.timedelta(days=30))
            out("CLOUDFRONT_TRANSFER_30D_GB", dims.get("DistributionId"), round(sum(month) / 1024 ** 3, 2))
    for b in ("media", "private"):
        bucket = "%s-%s-%s" % (PREFIX, ACCOUNT, b)
        for name in ("GetRequests", "PutRequests", "BytesDownloaded"):
            series = metric_series("AWS/S3", name, {"BucketName": bucket, "FilterId": "EntireBucket"}, "Sum", 86400,
                                   start=NOW - dt.timedelta(days=30))
            out("S3_REQUEST_METRIC", b, name, "30d_sum=%s" % (round(sum(series)) if series else "NO_DATA (request metrics off)"))


# ---------------------------------------------------------------- Round DB: where the database time goes (read-only)

# Round DB (Part 1): the window file reads "db <start> <end>" (the signed-in load test's window). Performance Insights
# keeps 7 days, so it gives the top SQL for that exact window; pg_stat_statements is cumulative since its last reset.
# Statements are normalised (PI tokenises values as ?, pg_stat_statements as $n): shapes only, never values.
DB_RUN_START, DB_RUN_END = os.environ.get("DB_RUN_START", ""), os.environ.get("DB_RUN_END", "")
PI_STATS = ["db.sql_tokenized.stats.calls_per_sec.avg", "db.sql_tokenized.stats.avg_latency_per_call.avg",
            "db.sql_tokenized.stats.rows_per_call.avg", "db.sql_tokenized.stats.shared_blks_hit_per_call.avg",
            "db.sql_tokenized.stats.shared_blks_read_per_call.avg", "db.sql_tokenized.stats.temp_blks_written_per_call.avg"]
STATEMENT_KINDS = r"^\s*(select|with|insert|update|delete)\b"
# The same test in PostgreSQL's regex dialect (\y is its word boundary; \b there is a backspace).
SQL_STATEMENT_KINDS = r"^\s*(select|with|insert|update|delete)\y"


def one_line(text, limit):
    return re.sub(r"\s+", " ", text or "").strip()[:limit]


def writer_resource():
    c = cluster()
    writer = next((m["DBInstanceIdentifier"] for m in c.get("DBClusterMembers", []) if m.get("IsClusterWriter")), None)
    inst = (aws("rds", "describe-db-instances", "--db-instance-identifier", writer) or {}).get("DBInstances", [{}])[0] if writer else {}
    return inst.get("DbiResourceId") if inst.get("PerformanceInsightsEnabled") else None


def pi_top(resource, label, start, end, limit=15):
    seconds = max(60, int((end - start).total_seconds()))
    load = aws("pi", "get-resource-metrics", "--service-type", "RDS", "--identifier", resource, "--start-time", iso(start),
               "--end-time", iso(end), "--period-in-seconds", "60" if seconds <= 7200 else "3600",
               "--metric-queries", '[{"Metric":"db.load.avg"},{"Metric":"os.cpuUtilization.total.avg"}]') or {}
    for m in load.get("MetricList", []):
        values = [p["Value"] for p in m.get("DataPoints", []) if p.get("Value") is not None]
        summarize("pi.%s.%s" % (label, m.get("Key", {}).get("Metric")), values)
    waits = aws("pi", "describe-dimension-keys", "--service-type", "RDS", "--identifier", resource, "--start-time", iso(start),
                "--end-time", iso(end), "--metric", "db.load.avg", "--group-by", '{"Group":"db.wait_event","Limit":8}') or {}
    for k in waits.get("Keys", []):
        d = k.get("Dimensions") or {}
        out("PI_WAIT", label, "load=%.4f" % k.get("Total", 0), "%s:%s" % (d.get("db.wait_event.type"), d.get("db.wait_event.name")))
    top = aws("pi", "describe-dimension-keys", "--service-type", "RDS", "--identifier", resource, "--start-time", iso(start),
              "--end-time", iso(end), "--metric", "db.load.avg", "--group-by", '{"Group":"db.sql_tokenized","Limit":%d}' % limit,
              "--additional-metrics", *PI_STATS) or {}
    total = sum(k.get("Total", 0) for k in top.get("Keys", [])) or 1
    for rank, k in enumerate(top.get("Keys", []), 1):
        a = k.get("AdditionalMetrics") or {}
        stat = lambda name: a.get("db.sql_tokenized.stats.%s.avg" % name)
        fmt = lambda v, f: (f % v) if isinstance(v, (int, float)) else "n/a"
        out("PI_TOP_SQL", label, "rank=%d" % rank, "load_AAS=%.4f" % k.get("Total", 0), "share=%.0f%%" % (100 * k.get("Total", 0) / total),
            "calls_per_s=%s" % fmt(stat("calls_per_sec"), "%.3f"), "ms_per_call=%s" % fmt(stat("avg_latency_per_call"), "%.2f"),
            "rows_per_call=%s" % fmt(stat("rows_per_call"), "%.1f"), "hit_blks=%s" % fmt(stat("shared_blks_hit_per_call"), "%.0f"),
            "read_blks=%s" % fmt(stat("shared_blks_read_per_call"), "%.1f"), "temp_blks=%s" % fmt(stat("temp_blks_written_per_call"), "%.1f"),
            "sql=" + one_line((k.get("Dimensions") or {}).get("db.sql_tokenized.statement", ""), 420))


PGSS_COLUMNS = ("queryid::text as id, calls::bigint as calls, round(total_exec_time::numeric / 1000, 1) as total_s, "
                "round(mean_exec_time::numeric, 2) as mean_ms, round(stddev_exec_time::numeric, 2) as stddev_ms, "
                "round(max_exec_time::numeric, 1) as max_ms, rows::bigint as rows, shared_blks_hit::bigint as hit, "
                "shared_blks_read::bigint as read, temp_blks_written::bigint as temp_written")


def pgss_top():
    where = "where query ~* '%s'" % SQL_STATEMENT_KINDS
    rows = sql_rows([
        "select " + PGSS_COLUMNS + ", left(regexp_replace(query, '\\s+', ' ', 'g'), 420) as q from pg_stat_statements "
        + where + " order by total_exec_time desc limit 15",
        "select " + PGSS_COLUMNS + ", left(regexp_replace(query, '\\s+', ' ', 'g'), 420) as q from pg_stat_statements "
        + where + " and calls >= 20 order by mean_exec_time desc limit 15",
        "select stats_reset::text as since, dealloc::bigint as dealloc from pg_stat_statements_info",
        "select count(*)::int as statements, round(sum(total_exec_time)::numeric / 1000, 0) as total_s, sum(calls)::bigint as calls "
        "from pg_stat_statements",
    ])
    for label, r in zip(("PGSS_TOP_TOTAL", "PGSS_TOP_MEAN", "PGSS_SINCE", "PGSS_TOTALS"), rows):
        if r is None:
            out(label, "UNAVAILABLE")
            continue
        for rank, row in enumerate(r, 1):
            q = row.pop("q", None)
            out(label, "rank=%d" % rank, json.dumps(row, sort_keys=True), ("sql=" + one_line(q, 420)) if q else "")
    return rows[0] or []


def section_db():
    out("=== ROUND DB PART 1: WHERE THE DATABASE TIME GOES (shapes and counts only) ===")
    resource = writer_resource()
    if not resource:
        out("PI UNAVAILABLE")
    else:
        if DB_RUN_START and DB_RUN_END:
            run_start, run_end = parse_minute(DB_RUN_START), parse_minute(DB_RUN_END)
            assert run_start < run_end <= run_start + dt.timedelta(hours=3), "the load test window must be under 3 hours"
            pi_top(resource, "load_test", run_start, run_end)
        pi_top(resource, "last_7d", NOW - dt.timedelta(days=7) + dt.timedelta(minutes=5), NOW)


# ---------------------------------------------------------------- Round DB: one load test window in detail (read-only)

PI_WINDOW_STATS = ["db.sql_tokenized.stats.calls_per_sec.avg", "db.sql_tokenized.stats.total_time_per_sec.avg",
                   "db.sql_tokenized.stats.avg_latency_per_call.avg", "db.sql_tokenized.stats.rows_per_call.avg"]
# Performance Insights database counters, per minute: the work behind the CPU (rows scanned and fetched, commits).
PI_COUNTERS = ["db.Tuples.tup_returned.avg", "db.Tuples.tup_fetched.avg", "db.Transactions.xact_commit.avg",
               "db.Cache.blks_hit.avg", "db.IO.blks_read.avg"]
RDS_MINUTE_METRICS = [("CPUUtilization", "Maximum"), ("ServerlessDatabaseCapacity", "Maximum"), ("ACUUtilization", "Maximum"),
                      ("DBLoad", "Average"), ("DBLoadCPU", "Average"), ("DBLoadNonCPU", "Average"),
                      ("DatabaseConnections", "Maximum"), ("CommitThroughput", "Average"), ("FreeableMemory", "Minimum")]


def db_window():
    assert DB_RUN_START and DB_RUN_END, "the dbwindow and dbminutes sections need the db window"
    start, end = parse_minute(DB_RUN_START), parse_minute(DB_RUN_END)
    assert start < end <= start + dt.timedelta(hours=3), "the load test window must be under 3 hours"
    return start, end


def host_labels():
    """Private address -> what runs there (an ECS service, the bootstrap host). Addresses are never printed."""
    labels = {}
    clusters = aws("ecs", "list-clusters") or {}
    ecs_cluster = next((a.split("/")[-1] for a in clusters.get("clusterArns", []) if PREFIX in a), None)
    services = (aws("ecs", "list-services", "--cluster", ecs_cluster) or {}).get("serviceArns", []) if ecs_cluster else []
    for name in [s.split("/")[-1] for s in services]:
        tasks = (aws("ecs", "list-tasks", "--cluster", ecs_cluster, "--service-name", name) or {}).get("taskArns", [])
        for t in (aws("ecs", "describe-tasks", "--cluster", ecs_cluster, "--tasks", *tasks[:100]) or {}).get("tasks", []) if tasks else []:
            for attachment in t.get("attachments", []):
                for d in attachment.get("details", []):
                    if d.get("name") == "privateIPv4Address":
                        labels[d.get("value")] = "ecs:" + name.replace(PREFIX + "-", "")
    for r in (aws("ec2", "describe-instances") or {}).get("Reservations", []):
        for i in r.get("Instances", []):
            tags = {t["Key"]: t["Value"] for t in i.get("Tags", [])}
            if i.get("PrivateIpAddress"):
                labels[i["PrivateIpAddress"]] = "ec2:" + tags.get("Name", "untagged").replace(PREFIX + "-", "")
    return labels


def pi_keys(resource, start, end, group, limit, extra=None):
    args = ["pi", "describe-dimension-keys", "--service-type", "RDS", "--identifier", resource, "--start-time", iso(start),
            "--end-time", iso(end), "--metric", "db.load.avg", "--group-by", json.dumps({"Group": group, "Limit": limit})]
    if extra:
        args += ["--additional-metrics", *extra]
    return (aws(*args) or {}).get("Keys", [])


def section_dbwindow():
    out("=== ROUND DB: THE LOAD TEST WINDOW IN DETAIL (statement shapes, roles, process kinds and counts only) ===")
    start, end = db_window()
    seconds = (end - start).total_seconds()
    out("DB_WINDOW", iso(start), iso(end), "minutes=%d" % (seconds // 60))
    resource = writer_resource()
    if not resource:
        out("PI UNAVAILABLE")
    else:
        # Who used the database time: client sessions or background processes (autovacuum, checkpointer, ...), which roles,
        # and which hosts (labelled web, worker or bootstrap; a task stopped since then reads not_running_now).
        for group, label in (("db.session_type", "PI_BY_PROCESS_KIND"), ("db.user", "PI_BY_ROLE"), ("db.application", "PI_BY_APPLICATION"),
                             ("db.wait_event", "PI_BY_WAIT")):
            for k in pi_keys(resource, start, end, group, 12):
                d = k.get("Dimensions") or {}
                name = ":".join(str(v) for key, v in sorted(d.items()) if key.endswith(".name") or key.endswith(".type"))
                out(label, "load_AAS=%.4f" % k.get("Total", 0), "db_s=%.0f" % (k.get("Total", 0) * seconds), one_line(name, 120) or "(none)")
        labels = host_labels()
        by_label = Counter()
        for k in pi_keys(resource, start, end, "db.host", 25):
            d = k.get("Dimensions") or {}
            by_label[labels.get(d.get("db.host.name") or "", "not_running_now")] += k.get("Total", 0)
        for name, load in by_label.most_common():
            out("PI_BY_HOST_KIND", "load_AAS=%.4f" % load, "db_s=%.0f" % (load * seconds), name)
        # The statements: PI's top 25 by database time, with calls and execution time over the window; then the same
        # statements by calls.
        rows = []
        for k in pi_keys(resource, start, end, "db.sql_tokenized", 25, PI_WINDOW_STATS):
            a = k.get("AdditionalMetrics") or {}
            calls_ps = a.get("db.sql_tokenized.stats.calls_per_sec.avg")
            time_ps = a.get("db.sql_tokenized.stats.total_time_per_sec.avg")
            rows.append({"load": k.get("Total", 0), "calls": calls_ps * seconds if isinstance(calls_ps, (int, float)) else None,
                         "exec_s": time_ps * seconds / 1000 if isinstance(time_ps, (int, float)) else None,
                         "ms": a.get("db.sql_tokenized.stats.avg_latency_per_call.avg"), "rows": a.get("db.sql_tokenized.stats.rows_per_call.avg"),
                         "sql": one_line((k.get("Dimensions") or {}).get("db.sql_tokenized.statement", ""), 240)})
        total = sum(r["load"] for r in rows) or 1
        fmt = lambda v, f: (f % v) if isinstance(v, (int, float)) else "n/a"
        for rank, r in enumerate(rows, 1):
            out("WINDOW_SQL_BY_TIME", "rank=%d" % rank, "db_s=%.0f" % (r["load"] * seconds), "share=%.0f%%" % (100 * r["load"] / total),
                "calls=%s" % fmt(r["calls"], "%.0f"), "exec_s=%s" % fmt(r["exec_s"], "%.1f"), "ms_per_call=%s" % fmt(r["ms"], "%.2f"),
                "rows_per_call=%s" % fmt(r["rows"], "%.1f"), "sql=" + r["sql"])
        by_calls = sorted(range(len(rows)), key=lambda i: -(rows[i]["calls"] or 0))[:10]
        out("WINDOW_SQL_BY_CALLS", "ranks_by_time=%s" % ",".join(str(i + 1) for i in by_calls),
            "calls=%s" % ",".join(fmt(rows[i]["calls"], "%.0f") for i in by_calls))
    # Background work in the window: autovacuum and autoanalyze runs that finished in it, and the final reminder worker's
    # sends and attempts (counts only).
    s, e = iso(start), iso(end)
    statements = [
        "select relname as tbl, last_autovacuum::text as autovacuum, last_autoanalyze::text as autoanalyze, n_live_tup::bigint as live, "
        "n_dead_tup::bigint as dead from pg_stat_user_tables where schemaname = 'public' and (last_autovacuum between '%s' and '%s' "
        "or last_autoanalyze between '%s' and '%s') order by greatest(last_autovacuum, last_autoanalyze)" % (s, e, s, e),
        "select count(*) filter (where sent_at >= '%s' and sent_at < '%s')::int as sent, "
        "count(*) filter (where last_attempt_at >= '%s' and last_attempt_at < '%s')::int as attempted, "
        "count(*) filter (where status = 'queued')::int as queued_now from public.legacy_profile_invite_final_reminders" % (s, e, s, e),
        "select event_type as kind, count(*)::int as n from public.email_delivery_events where recorded_at >= '%s' and recorded_at < '%s' "
        "group by 1 order by 2 desc" % (s, e),
    ]
    for label, r in zip(("AUTOVACUUM_IN_WINDOW", "FINAL_REMINDER_IN_WINDOW", "EMAIL_EVENTS_IN_WINDOW"), [sql_rows([q])[0] for q in statements]):
        if r is None:
            out(label, "UNAVAILABLE")
            continue
        out(label, "count=%d" % len(r))
        for row in r:
            out(label, json.dumps(row, sort_keys=True)[:300])


def section_dbminutes():
    out("=== ROUND DB: THE LOAD TEST WINDOW MINUTE BY MINUTE (Aurora metrics and counters only) ===")
    start, end = db_window()
    series = {}
    for name, stat in RDS_MINUTE_METRICS:
        series[name] = dict(metric_points("AWS/RDS", name, {"DBClusterIdentifier": CLUSTER_ID}, stat, 60, start, end))
    resource = writer_resource()
    if resource:
        data = aws("pi", "get-resource-metrics", "--service-type", "RDS", "--identifier", resource, "--start-time", iso(start),
                   "--end-time", iso(end), "--period-in-seconds", "60",
                   "--metric-queries", json.dumps([{"Metric": m} for m in PI_COUNTERS])) or {}
        for m in data.get("MetricList", []):
            key = m.get("Key", {}).get("Metric", "")
            series[key] = {dt.datetime.fromisoformat(str(p["Timestamp"]).replace("Z", "+00:00")).replace(second=0, microsecond=0): p["Value"]
                           for p in m.get("DataPoints", []) if p.get("Value") is not None}
    short = {"CPUUtilization": "cpu", "ServerlessDatabaseCapacity": "acu", "ACUUtilization": "acu_pct", "DBLoad": "load",
             "DBLoadCPU": "load_cpu", "DBLoadNonCPU": "load_noncpu", "DatabaseConnections": "conns", "CommitThroughput": "commits_s",
             "FreeableMemory": "free_mb", "db.Tuples.tup_returned.avg": "rows_scanned_s", "db.Tuples.tup_fetched.avg": "rows_fetched_s",
             "db.Transactions.xact_commit.avg": "xact_s", "db.Cache.blks_hit.avg": "blks_hit_s", "db.IO.blks_read.avg": "blks_read_s"}
    t = start
    while t < end:
        cells = []
        for key, values in series.items():
            v = values.get(t)
            if v is None:
                continue
            if key == "FreeableMemory":
                v = v / 1048576
            cells.append("%s=%s" % (short.get(key, key), ("%.0f" % v) if abs(v) >= 100 else ("%.2f" % v)))
        out("MINUTE", t.strftime("%H:%M"), *cells)
        t += dt.timedelta(minutes=1)


EDGE_ALB_METRICS = ["RequestCount", "HTTPCode_ELB_5XX_Count", "HTTPCode_ELB_502_Count", "HTTPCode_ELB_503_Count",
                    "HTTPCode_ELB_504_Count", "HTTPCode_ELB_4XX_Count", "HTTPCode_Target_5XX_Count"]


def edge_log_minutes(start, end):
    """Per minute from the ALB access logs: requests, the load test's share, and status codes that are errors or a
    client that went away (460). Status codes and counts only."""
    rows = defaultdict(Counter)
    totals, budget = Counter(), {"bytes": 0}
    day = start.date()
    while day <= end.date():
        for line in alb_day_lines(day, totals, budget):
            m = LOG_LINE.match(line)
            if not m or not (iso(start)[:19] <= m.group(2)[:19] < iso(end)[:19]):
                continue
            minute = m.group(2)[11:16]
            elb, target = m.group(9), m.group(10)
            row = rows[minute]
            row["alb_logged"] += 1
            if LOAD_TEST_STEP.search(m.group(14)) or "SeaNShore-LoadTest" in m.group(14):
                row["load_test"] += 1
            if elb.startswith("5") or elb == "460":
                row["elb_%s_target_%s" % (elb, target)] += 1
        day += dt.timedelta(days=1)
    return rows, totals


def section_edgeminutes():
    out("=== ROUND DB: EDGE AND LOAD BALANCER ERRORS MINUTE BY MINUTE (status codes and counts only) ===")
    start, end = db_window()
    rows = defaultdict(dict)
    for dims in search_dims("AWS/CloudFront", "Requests", "", region=EDGE):
        if dims.get("Region") != "Global":
            continue
        tag = "cf_" + str(dims.get("DistributionId", "?"))[-4:]
        for name, stat, key in (("Requests", "Sum", "req"), ("5xxErrorRate", "Average", "5xx_pct"), ("4xxErrorRate", "Average", "4xx_pct")):
            for t, v in metric_points("AWS/CloudFront", name, dims, stat, 60, start, end, region=EDGE):
                rows[t.strftime("%H:%M")]["%s_%s" % (tag, key)] = v
    for dims in search_dims("AWS/ApplicationELB", "RequestCount", PREFIX + "-alb"):
        if set(dims) != {"LoadBalancer"}:
            continue
        for name in EDGE_ALB_METRICS:
            for t, v in metric_points("AWS/ApplicationELB", name, dims, "Sum", 60, start, end):
                rows[t.strftime("%H:%M")]["alb_" + name.replace("HTTPCode_", "").replace("_Count", "")] = v
    logged, totals = edge_log_minutes(start, end)
    for minute, counts in logged.items():
        rows[minute].update(counts)
    out("EDGE_LOG_TOTALS", json.dumps(dict(totals), sort_keys=True))
    for minute in sorted(rows):
        cells = ["%s=%s" % (k, ("%.0f" % v) if isinstance(v, (int, float)) and float(v).is_integer() else ("%.2f" % v))
                 for k, v in sorted(rows[minute].items()) if v]
        out("EDGE_MINUTE", minute, *cells)


def section_dbstats():
    out("=== ROUND DB PART 1: pg_stat_statements, cumulative since its reset (shapes only) ===")
    pgss_top()


def plan_nodes(node, depth=0, found=None):
    """Plan nodes with what matters for cost: type, table, index, estimated rows and cost. No values."""
    found = [] if found is None else found
    entry = node.get("Node Type", "?")
    if node.get("Relation Name"):
        entry += " on " + node["Relation Name"]
    if node.get("Index Name"):
        entry += " using " + node["Index Name"]
    if node.get("Sort Key"):
        entry += " sort(%d keys)" % len(node["Sort Key"])
    entry += " rows~%s cost~%s" % (int(node.get("Plan Rows", 0)), int(node.get("Total Cost", 0)))
    found.append("%s%s" % (">" * depth, entry))
    for child in node.get("Plans", []) or []:
        plan_nodes(child, depth + 1, found)
    return found


PLAN_NODE = re.compile(r"^(\s*)(?:->\s+)?([A-Z][A-Za-z ]+?)(?: using (\w+))?(?: on (\w+)(?: \w+)?)?\s+\(cost=[\d.]+\.\.([\d.]+) rows=(\d+)")
# Round DB (12 Nov): Aurora's captured plans can come without the cost figures; such a node line ends after the node
# (an alias at most). SubPlan, InitPlan and CTE markers are kept: they show what runs once per row.
PLAN_NODE_BARE = re.compile(r"^(\s*)(?:->\s+)?([A-Z][A-Za-z ]+?)(?: using (\w+))?(?: on (\w+)(?: \w+)?)?\s*$")
PLAN_MARKER = re.compile(r"^(\s*)(SubPlan|InitPlan|CTE) (\w+)")


def text_plan_nodes(plan_text):
    """Node lines of a text plan: type, index, table, estimated rows and cost. Condition and filter lines (which can
    hold values) are dropped, and nothing quoted is ever kept."""
    found = []
    for line in (plan_text or "").splitlines():
        m = PLAN_NODE.match(line)
        if m:
            indent, node, index, table, cost, rows = m.groups()
            entry = node.strip() + (" on " + table if table else "") + (" using " + index if index else "")
            found.append("%s%s rows~%s cost~%d" % (">" * (len(indent) // 6), entry, rows, float(cost)))
            continue
        marker = PLAN_MARKER.match(line)
        if marker:
            found.append("%s%s %s" % (">" * (len(marker.group(1)) // 6), marker.group(2), marker.group(3)))
            continue
        bare = PLAN_NODE_BARE.match(line)
        if bare and "->" in line or (bare and not found):
            indent, node, index, table = bare.groups()
            found.append("%s%s" % (">" * (len(indent) // 6), node.strip() + (" on " + table if table else "") + (" using " + index if index else "")))
    return found


def captured_plan_nodes(plan):
    """Aurora's captured plan as nodes, whether it is stored as JSON or as text."""
    text = plan if isinstance(plan, str) else json.dumps(plan)
    stripped = (text or "").lstrip()
    if stripped[:1] in "[{":
        try:
            parsed = json.loads(stripped)
            root = parsed[0] if isinstance(parsed, list) else parsed
            return "json", plan_nodes(root.get("Plan", root))
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            return "json-unreadable", []
    return "text", text_plan_nodes(text)


def plan_flags(nodes):
    return sorted({f for n in nodes for f, hit in (("SEQ_SCAN", "Seq Scan" in n), ("SORT", "Sort" in n),
                   ("NESTED_LOOP", "Nested Loop" in n), ("HASH_JOIN", "Hash Join" in n)) if hit})


def section_dbplans():
    out("=== ROUND DB PART 1: PLANS OF THE TOP STATEMENTS (EXPLAIN GENERIC_PLAN, nothing executed; else Aurora's captured plans) ===")
    top = sql_rows(["select queryid::text as id, query as q from pg_stat_statements where query ~* '%s' "
                    "order by total_exec_time desc limit 12" % SQL_STATEMENT_KINDS])[0] or []
    missing = []
    for row in top:
        q = row.get("q") or ""
        if not re.match(STATEMENT_KINDS, q, re.I) or ";" in q.strip().rstrip(";"):
            out("PLAN", "id=%s" % row.get("id"), "SKIPPED")
            continue
        r = sql_rows([EXPLAIN_PREFIX + q.strip().rstrip(";")])[0]
        try:
            value = list(r[0].values())[0]
            plan = (json.loads(value) if isinstance(value, str) else value)[0]["Plan"]
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            missing.append(row.get("id"))
            continue
        nodes = plan_nodes(plan)
        out("PLAN", "id=%s" % row.get("id"), "source=generic", "flags=%s" % ",".join(plan_flags(nodes)), "nodes=%d" % len(nodes),
            " | ".join(nodes)[:900])
    ids = [i for i in missing if i and re.fullmatch(r"-?\d+", i)]
    if ids:
        captured = sql_rows(["select queryid::text as id, calls::bigint as calls, explain_plan as p from aurora_stat_plans(true) "
                             "where queryid in (%s) order by calls desc" % ",".join(ids)])[0]
        if captured is None:
            out("PLAN_CAPTURED", "UNAVAILABLE", "ids=%d" % len(ids))
        for row in captured or []:
            raw = row.pop("p", "")
            kind, nodes = captured_plan_nodes(raw)
            lines = len(raw.splitlines()) if isinstance(raw, str) else 0
            out("PLAN", "id=%s" % row.get("id"), "source=captured", "format=%s" % kind, "lines=%d" % lines, "calls=%s" % row.get("calls"),
                "flags=%s" % ",".join(plan_flags(nodes)), "nodes=%d" % len(nodes), " | ".join(nodes)[:1800])


def section_dbhealth():
    out("=== ROUND DB PART 1: INDEX, TABLE AND CONNECTION HEALTH (counts and names of schema objects only) ===")
    statements = [
        "select stats_reset::text as since from pg_stat_database where datname = current_database()",
        # Indexes never used since the statistics reset (unique and primary keys enforce rules, so they are listed apart).
        "select s.relname as tbl, s.indexrelname as idx, s.idx_scan::bigint as scans, pg_relation_size(s.indexrelid)::bigint as bytes, "
        "i.indisunique as uniq, i.indisprimary as pk from pg_stat_user_indexes s join pg_index i on i.indexrelid = s.indexrelid "
        "where s.schemaname = 'public' and s.idx_scan = 0 order by pg_relation_size(s.indexrelid) desc limit 40",
        # Duplicate (same key) or overlapping (key is a prefix of another non-partial index's key) plain indexes.
        "select a.indrelid::regclass::text as tbl, a.indexrelid::regclass::text as idx, b.indexrelid::regclass::text as covered_by, "
        "(a.indkey::text = b.indkey::text) as same_key from pg_index a join pg_index b on a.indrelid = b.indrelid "
        "and a.indexrelid <> b.indexrelid and a.indpred is null and b.indpred is null and a.indexprs is null and b.indexprs is null "
        "and not a.indisunique and (b.indkey::text like a.indkey::text || ' %' or (b.indkey::text = a.indkey::text and a.indexrelid > b.indexrelid)) "
        "join pg_class c on c.oid = a.indrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' limit 40",
        # The 15 biggest tables.
        "select relname as tbl, n_live_tup::bigint as live, n_dead_tup::bigint as dead, seq_scan::bigint as seq_scans, "
        "seq_tup_read::bigint as seq_rows_read, coalesce(idx_scan, 0)::bigint as idx_scans, n_mod_since_analyze::bigint as mod_since_analyze, "
        "pg_total_relation_size(relid)::bigint as bytes, greatest(last_vacuum, last_autovacuum)::date::text as vacuumed, "
        "greatest(last_analyze, last_autoanalyze)::date::text as analyzed from pg_stat_user_tables where schemaname = 'public' "
        "order by pg_total_relation_size(relid) desc limit 15",
        # Tables read mostly by sequential scan.
        "select relname as tbl, seq_scan::bigint as seq_scans, seq_tup_read::bigint as seq_rows_read, coalesce(idx_scan, 0)::bigint as idx_scans, "
        "n_live_tup::bigint as live from pg_stat_user_tables where schemaname = 'public' and seq_scan > 1000 and n_live_tup > 1000 "
        "order by seq_tup_read desc limit 15",
        "select datname as db, numbackends::int as backends, xact_commit::bigint as commits, blks_hit::bigint as hit, blks_read::bigint as read, "
        "temp_files::bigint as temp_files, temp_bytes::bigint as temp_bytes, deadlocks::bigint as deadlocks from pg_stat_database "
        "where datname = current_database()",
        "select usename as role, coalesce(application_name, '') as app, state, count(*)::int as n from pg_stat_activity "
        "where backend_type = 'client backend' group by 1, 2, 3 order by 4 desc limit 20",
        "select rolname as role, coalesce(array_to_string(rolconfig, ','), '') as settings from pg_roles "
        "where rolcanlogin and rolname not like 'rds%' order by 1",
        "select name, setting, unit from pg_settings where name in ('max_connections', 'shared_buffers', 'work_mem', "
        "'effective_cache_size', 'random_page_cost', 'statement_timeout', 'idle_in_transaction_session_timeout', "
        "'pg_stat_statements.max', 'pg_stat_statements.track', 'track_io_timing', 'default_statistics_target', "
        "'autovacuum_vacuum_scale_factor', 'autovacuum_analyze_scale_factor') order by name",
    ]
    # One read-only transaction per statement, so one failing statement cannot hide the others.
    rows = [sql_rows([statement])[0] for statement in statements]
    labels = ["STATS_SINCE", "INDEX_UNUSED", "INDEX_DUPLICATE_OR_OVERLAP", "TABLE_BIGGEST", "TABLE_SEQ_SCANNED",
              "DB_TOTALS", "CONNECTIONS_BY_ROLE_STATE", "ROLE_SETTINGS", "SETTINGS"]
    for label, r in zip(labels, rows):
        if r is None:
            out(label, "UNAVAILABLE")
            continue
        out(label, "count=%d" % len(r))
        for row in r:
            out(label, json.dumps(row, sort_keys=True)[:400])


# ---------------------------------------------------------------- Round DB: cost (read-only)

def section_cost():
    out("=== ROUND DB PART 3: COST AND IDLE RESOURCES (amounts, counts and resource names only) ===")
    month_start = NOW.replace(day=1, hour=0, minute=0).date()
    last_month_start = (month_start - dt.timedelta(days=1)).replace(day=1)
    for label, s, e in (("last_month", last_month_start, month_start), ("month_to_date", month_start, NOW.date())):
        if s >= e:
            continue
        data = aws("ce", "get-cost-and-usage", "--time-period", "Start=%s,End=%s" % (s, e), "--granularity", "MONTHLY",
                   "--metrics", "UnblendedCost", "UsageQuantity", "--group-by", "Type=DIMENSION,Key=SERVICE",
                   "Type=DIMENSION,Key=USAGE_TYPE", region=EDGE) or {}
        groups = [g for p in data.get("ResultsByTime", []) for g in p.get("Groups", [])]
        groups.sort(key=lambda g: -float(g["Metrics"]["UnblendedCost"]["Amount"]))
        total = sum(float(g["Metrics"]["UnblendedCost"]["Amount"]) for g in groups)
        out("COST_TOTAL", label, "%s..%s" % (s, e), "USD=%.2f" % total, "lines=%d" % len(groups))
        for g in groups[:15]:
            out("COST_LINE", label, " / ".join(g["Keys"]), "USD=%.2f" % float(g["Metrics"]["UnblendedCost"]["Amount"]),
                "qty=%.1f" % float(g["Metrics"]["UsageQuantity"]["Amount"]))
    nat = (aws("ec2", "describe-nat-gateways") or {}).get("NatGateways", [])
    out("NAT_GATEWAYS", "count=%d" % len([n for n in nat if n.get("State") == "available"]))
    eips = (aws("ec2", "describe-addresses") or {}).get("Addresses", [])
    out("ELASTIC_IPS", "count=%d" % len(eips), "unattached=%d" % len([a for a in eips if not a.get("AssociationId")]))
    vols = (aws("ec2", "describe-volumes") or {}).get("Volumes", [])
    out("EBS_VOLUMES", "count=%d" % len(vols), "GB=%d" % sum(v.get("Size", 0) for v in vols),
        "unattached=%d" % len([v for v in vols if v.get("State") == "available"]),
        "unattachedGB=%d" % sum(v.get("Size", 0) for v in vols if v.get("State") == "available"))
    snaps = (aws("ec2", "describe-snapshots", "--owner-ids", "self") or {}).get("Snapshots", [])
    out("EBS_SNAPSHOTS", "count=%d" % len(snaps), "GB=%d" % sum(s.get("VolumeSize", 0) for s in snaps),
        "oldest=%s" % (min((s.get("StartTime", "")[:10] for s in snaps), default="none")))
    rds_snaps = (aws("rds", "describe-db-cluster-snapshots", "--snapshot-type", "manual") or {}).get("DBClusterSnapshots", [])
    out("AURORA_MANUAL_SNAPSHOTS", "count=%d" % len(rds_snaps), "oldest=%s" % min((s.get("SnapshotCreateTime", "")[:10] for s in rds_snaps), default="none"))
    lbs = (aws("elbv2", "describe-load-balancers") or {}).get("LoadBalancers", [])
    for lb in lbs:
        tgs = (aws("elbv2", "describe-target-groups", "--load-balancer-arn", lb["LoadBalancerArn"]) or {}).get("TargetGroups", [])
        out("LOAD_BALANCER", lb.get("LoadBalancerName"), lb.get("Type"), "scheme=%s" % lb.get("Scheme"), "targetGroups=%d" % len(tgs))
    clusters = (aws("ecs", "describe-clusters", "--clusters", PREFIX, "--include", "SETTINGS") or {}).get("clusters", [])
    for c in clusters:
        out("ECS_CLUSTER_SETTINGS", c.get("clusterName"), json.dumps(c.get("settings", [])),
            "capacityProviders=%s" % ",".join(c.get("capacityProviders", [])))
    groups = (aws("logs", "describe-log-groups") or {}).get("logGroups", [])
    out("LOG_GROUPS", "count=%d" % len(groups), "noRetention=%d" % len([g for g in groups if not g.get("retentionInDays")]),
        "storedGB=%.2f" % (sum(g.get("storedBytes", 0) for g in groups) / 1024 ** 3))
    for g in sorted(groups, key=lambda g: -g.get("storedBytes", 0))[:25]:
        out("LOG_GROUP", g.get("logGroupName"), "retentionDays=%s" % g.get("retentionInDays", "never"),
            "storedMB=%.1f" % (g.get("storedBytes", 0) / 1048576))
    custom = Counter()
    for m in (aws("cloudwatch", "list-metrics") or {}).get("Metrics", []):
        if not m.get("Namespace", "").startswith("AWS/"):
            custom[m["Namespace"]] += 1
    out("CUSTOM_METRICS", json.dumps(dict(custom), sort_keys=True))
    for b in ("media", "private", "migration", "load-test-handoff"):
        bucket = "%s-%s-%s" % (PREFIX, ACCOUNT, b)
        rules = (aws("s3api", "get-bucket-lifecycle-configuration", "--bucket", bucket, quiet=True) or {}).get("Rules", [])
        uploads = (aws("s3api", "list-multipart-uploads", "--bucket", bucket, quiet=True) or {}).get("Uploads", []) or []
        out("S3_BUCKET", b, "lifecycleRules=%d" % len(rules), "incompleteUploads=%d" % len(uploads),
            "rules=%s" % ",".join(sorted(r.get("ID", "?") for r in rules)))
    versions = aws("s3api", "list-object-versions", "--bucket", "%s-%s-media" % (PREFIX, ACCOUNT),
                   "--query", "Versions[?IsLatest==`false`].[Size,LastModified]") or []
    old = [v for v in versions if v and v[1] and v[1][:10] < (NOW - dt.timedelta(days=30)).date().isoformat()]
    out("S3_MEDIA_NONCURRENT", "versions=%d" % len(versions), "GB=%.3f" % (sum(v[0] for v in versions if v) / 1024 ** 3),
        "olderThan30d=%d" % len(old), "olderThan30dGB=%.3f" % (sum(v[0] for v in old) / 1024 ** 3))
    for r in (aws("ecr", "describe-repositories") or {}).get("repositories", []):
        images = (aws("ecr", "describe-images", "--repository-name", r["repositoryName"]) or {}).get("imageDetails", [])
        policy = aws("ecr", "get-lifecycle-policy", "--repository-name", r["repositoryName"], quiet=True)
        out("ECR_REPOSITORY", r["repositoryName"], "images=%d" % len(images),
            "GB=%.2f" % (sum(i.get("imageSizeInBytes", 0) for i in images) / 1024 ** 3), "lifecyclePolicy=%s" % bool(policy))


def main():
    out("CAPACITY_MEDIA_REPORT section=%s window_days=%d now=%s" % (SECTION, DAYS, iso(NOW)))
    {"config": section_config, "usage": section_usage, "media": section_media, "compare": section_compare, "checks": section_checks,
     "db": section_db, "dbstats": section_dbstats, "dbplans": section_dbplans, "dbhealth": section_dbhealth, "cost": section_cost,
     "dbwindow": section_dbwindow, "dbminutes": section_dbminutes, "edgeminutes": section_edgeminutes,
     "dbcompare": section_dbcompare, "online": section_online, "capminutes": section_capminutes, "capwrites": section_capwrites, "cap7d": section_cap7d, "caponline": section_caponline, "legacysplit": section_legacysplit,
     "sessdb": section_sessdb, "sessmetric": section_sessmetric, "sessstale": section_sessstale}[SECTION]()
    out("ACTION_SUMMARY", json.dumps(dict(COUNTS)))
    out("READ_ONLY_REPORT_COMPLETE=true")


if __name__ == "__main__":
    main()
