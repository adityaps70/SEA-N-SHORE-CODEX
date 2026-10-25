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
        for statement in statements:
            assert re.match(r"^\s*(select|show|with)\b", statement, re.I), "read-only statements only"
            r = aws("rds-data", "execute-statement", *base, "--transaction-id", txid, "--sql", statement,
                    "--format-records-as", "JSON")
            results.append(json.loads(r["formattedRecords"]) if r and r.get("formattedRecords") else None)
    finally:
        aws("rds-data", "rollback-transaction", *base, "--transaction-id", txid, quiet=True)
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


def route_shape(path):
    parts = [p for p in path.split("/") if p][:3]
    return "/" + "/".join(p.lower() if p.lower() in ROUTE_WORDS else ":x" for p in parts)


def parse_alb_line(line, totals, per_minute, by_route, errors_by_route, bot):
    m = LOG_LINE.match(line)
    if not m:
        return
    t = m.group(2)
    if t < iso(START):
        return
    target_time = float(m.group(7))
    status = m.group(9)
    request = m.group(13).split(" ")
    method = request[0] if request else "-"
    url = request[1] if len(request) > 1 else ""
    path = re.sub(r"^https?://[^/]+(:\d+)?", "", url).split("?")[0] or "/"
    query = url.split("?", 1)[1] if "?" in url else ""
    ua = m.group(14)
    totals["requests"] += 1
    per_minute[t[:16]] += 1
    if bot.search(ua):
        totals["bot_or_probe"] += 1
    if STATIC.search(path):
        totals["static_at_origin"] += 1
        return
    kind = ("image" if path.startswith("/_next/image") else "rsc" if "_rsc=" in query else
            "action" if method == "POST" and not path.startswith("/api/") else "api" if path.startswith("/api/") else "page")
    key = "%s %s" % (kind, route_shape(path))
    if target_time >= 0:
        by_route[key].append(target_time)
    if status.startswith("5"):
        errors_by_route[key] += 1
        totals["5xx"] += 1


def alb_log_stats():
    bucket = "%s-%s-alb-logs" % (PREFIX, ACCOUNT)
    totals = Counter()
    per_minute = Counter()
    by_route = defaultdict(list)
    errors_by_route = Counter()
    bot = re.compile(r"bot|crawl|spider|slurp|HealthProbe|ELB-HealthChecker|Lighthouse|curl|python|Go-http|axios|node-fetch|headless", re.I)
    bytes_scanned = 0
    day = START.date()
    while day <= NOW.date():
        prefix = "alb/AWSLogs/%s/elasticloadbalancing/%s/%04d/%02d/%02d/" % (ACCOUNT, REGION, day.year, day.month, day.day)
        day += dt.timedelta(days=1)
        listing = aws("s3api", "list-objects-v2", "--bucket", bucket, "--prefix", prefix) or {}
        day_bytes = sum(o["Size"] for o in listing.get("Contents", []))
        if not day_bytes:
            continue
        if bytes_scanned + day_bytes > 6 * 1024 ** 3:
            totals["days_skipped_size_cap"] += 1
            continue
        bytes_scanned += day_bytes
        with tempfile.TemporaryDirectory() as tmp:
            got = subprocess.run(["aws", "s3", "cp", "s3://%s/%s" % (bucket, prefix), tmp, "--recursive", "--only-show-errors",
                                  "--region", REGION], capture_output=True, timeout=1800)
            if got.returncode != 0:
                totals["log_days_read_errors"] += 1
                continue
            for root, _dirs, files in os.walk(tmp):
                for file_name in files:
                    with gzip.open(os.path.join(root, file_name), "rt", errors="replace") as fh:
                        for line in fh:
                            parse_alb_line(line, totals, per_minute, by_route, errors_by_route, bot)
    out("ALB_LOGS", "scannedMB=%s" % mb(bytes_scanned), json.dumps(dict(totals)))
    if per_minute:
        rpm = list(per_minute.values())
        out("ALB_REQ_PER_MIN", "avg_nonzero=%s" % round(statistics.fmean(rpm), 2), "p95=%s" % pct(rpm, 95), "max=%s" % max(rpm),
            "minutesWithTraffic=%d" % len(rpm), "of=%d" % (DAYS * 1440))
    ranked = sorted(by_route.items(), key=lambda kv: -len(kv[1]))[:30]
    for key, times in ranked:
        out("ROUTE", key, "n=%d" % len(times), "p50=%.3f" % pct(times, 50), "p95=%.3f" % pct(times, 95),
            "p99=%.3f" % pct(times, 99), "max=%.3f" % max(times), "wallSecTotal=%.0f" % sum(times), "5xx=%d" % errors_by_route[key])
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


def main():
    out("CAPACITY_MEDIA_REPORT section=%s window_days=%d now=%s" % (SECTION, DAYS, iso(NOW)))
    {"config": section_config, "usage": section_usage, "media": section_media}[SECTION]()
    out("ACTION_SUMMARY", json.dumps(dict(COUNTS)))
    out("READ_ONLY_REPORT_COMPLETE=true")


if __name__ == "__main__":
    main()
