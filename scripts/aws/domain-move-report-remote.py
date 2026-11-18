#!/usr/bin/env python3
"""Domain move (seanshore.net), Phase 0: one read-only inventory of everything tied to a Sea N Shore domain.

Runs on the bootstrap host through SSM (scripts/aws/domain-move-report.sh, report-once only). Every AWS call is a
describe, get or list (scripts/aws/domain-move-report-guard.test.mjs enforces it); SQL runs through the RDS Data API in
a READ ONLY transaction that is rolled back and returns counts only; the Resend calls are GETs. The one write is a
single PutObject of the finished report to

    s3://sea-n-shore-staging-310356785722-migration/private-reports/domain-move/phase0-<sha>.json

(SSE-S3, deleted by the private-reports/ lifecycle rule after 14 days). The repository and its Actions logs are
public, so stdout carries only DOMAIN_MOVE_REPORT=PASS|FAIL, the failing stage, and the report's SHA-256. Everything
else, errors included, goes into the private report.

Never read: secret values beyond the Resend admin key (used for the GETs, never stored), origin custom header values,
client secrets, member rows. Zones outside the seven of the move are counted, never described or named.
"""
import copy
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

REGION = "ap-south-1"
EDGE = "us-east-1"
ACCOUNT = "310356785722"
PREFIX = "sea-n-shore-staging"
REPORT_BUCKET = "sea-n-shore-staging-310356785722-migration"
REPORT_PREFIX = "private-reports/domain-move/"
STATE_BUCKET = "sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY = "sea-n-shore/staging/terraform.tfstate"
STATE_LINEAGE = "197a6fae-9997-636e-e52b-c3ac6da85d90"
CLUSTER_ID = PREFIX + "-aurora"
DATABASE = "sea_n_shore"
RESEND_ADMIN_SECRET = "sea-n-shore/resend-admin"
RESEND_DOMAINS = ["mail.seanshore.net", "mail.seanshore.in"]

# The seven zones of the move. Every other hosted zone is counted only.
IN_SCOPE_ZONES = [
    "seanshore.net",
    "seanshore.in",
    "seaandshore.in",
    "seanshore.ph",
    "seanshore.nl",
    "seanshore.si",
    "seaandshore.si",
]
# Subdomains of the move whose resolution matters (A/AAAA/CNAME/MX looked up through public resolvers).
PUBLIC_LOOKUPS = [
    ("seanshore.net", "NS"), ("seanshore.in", "NS"), ("seaandshore.in", "NS"), ("seanshore.ph", "NS"),
    ("seanshore.nl", "NS"), ("seanshore.si", "NS"), ("seaandshore.si", "NS"),
    ("mail.seanshore.in", "MX"), ("send.mail.seanshore.in", "MX"), ("mail.seanshore.net", "MX"),
    ("send.mail.seanshore.net", "MX"),
]
# Information only (owner, 17 Nov): rows that mention an old domain are counted, never read or rewritten.
DB_COUNT_TABLES = [
    "site_settings", "newsletter_campaigns", "notifications", "posts", "post_comments", "messages", "profiles",
    "companies", "jobs", "events", "learning_courses", "learning_lessons", "learning_course_announcements",
    "support_ticket_messages",
]
DB_PATTERNS = {"seanshore_in": r"seanshore\.in([^a-z0-9]|$)", "seaandshore_in": r"seaandshore\.in([^a-z0-9]|$)"}
# Environment variables whose values are configuration (never secrets) and are read by name.
ENV_KEYS = {
    "NEXT_PUBLIC_SITE_URL", "MEDIA_CDN_ORIGIN", "SERVER_ACTION_ALLOWED_ORIGINS", "HEALTH_PROBE_SITE_URL",
    "NEWSLETTER_FROM_ADDRESS", "REALTIME_ALLOWED_ORIGINS", "REALTIME_ALLOWED_ORIGIN", "SITE_URL", "EMAIL_FROM",
    "AWS_COGNITO_DOMAIN", "REALTIME_WEBSOCKET_URL",
}
LAMBDA_NAMES = re.compile(r"realtime-authorizer|cognito-resend-email-sender|cognito-pre-sign-up")
IDP_DETAIL_KEYS = {"authorize_scopes", "attributes_url", "authorize_url", "token_url", "oidc_issuer",
                   "attributes_url_add_attributes", "token_request_method"}
STATE_TYPES = {
    "aws_route53_zone": ("zone_id", "name", "comment"),
    "aws_route53_record": ("zone_id", "name", "type", "fqdn", "set_identifier"),
    "aws_cloudfront_distribution": ("id", "aliases", "comment"),
    "aws_cloudfront_function": ("name",),
    "aws_acm_certificate": ("arn", "domain_name", "subject_alternative_names", "status"),
    "aws_cognito_user_pool_domain": ("domain",),
    "aws_sesv2_email_identity": ("email_identity",),
    "aws_s3_bucket_lifecycle_configuration": ("bucket",),
}
ACM_KEY_TYPES = "keyTypes=RSA_1024,RSA_2048,RSA_3072,RSA_4096,EC_prime256v1,EC_secp384r1,EC_secp521r1"


def local_override(name, default):
    """Tests point these at a local fake; anything but a loopback URL is refused."""
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    if not re.fullmatch(r"http://127\.0\.0\.1:[0-9]{2,5}", value):
        raise SystemExit("DOMAIN_MOVE_REPORT=FAIL stage=config")
    return value


RESEND_API = local_override("DOMAIN_MOVE_REPORT_TEST_RESEND_API", "https://api.resend.com")
DOH_RESOLVERS = {
    "cloudflare": local_override("DOMAIN_MOVE_REPORT_TEST_DOH_CLOUDFLARE", "https://cloudflare-dns.com") + "/dns-query",
    "google": local_override("DOMAIN_MOVE_REPORT_TEST_DOH_GOOGLE", "https://dns.google") + "/resolve",
}

ERRORS = []
STATS = {"aws_calls": 0, "http_calls": 0, "sql_statements": 0}


def scrub(text):
    """An error line without ARNs, account ids or anything that looks like a key."""
    text = re.sub(r"arn:aws[a-z-]*:\S+", "[arn]", text or "")
    text = re.sub(r"\b[0-9]{12}\b", "[account]", text)
    text = re.sub(r"\bre_[A-Za-z0-9_]+", "[key]", text)
    return text.strip()[:240]


def note_error(where, detail):
    ERRORS.append({"where": where, "error": scrub(detail)})


def aws(service, action, *args, region=REGION, quiet=False):
    """One read-only AWS CLI call; None when it fails (recorded in the report, never printed)."""
    command = ["aws", service, action, *[str(a) for a in args], "--region", region, "--output", "json"]
    try:
        done = subprocess.run(command, text=True, capture_output=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired) as exc:
        note_error(f"{service} {action}", type(exc).__name__)
        return None
    STATS["aws_calls"] += 1
    if done.returncode != 0:
        if not quiet:
            lines = done.stderr.strip().splitlines()
            note_error(f"{service} {action}", lines[-1] if lines else "failed")
        return None
    return json.loads(done.stdout) if done.stdout.strip() else {}


def http_json(url, headers=None):
    request_headers = {"Accept": "application/json", "User-Agent": "sea-n-shore-ops"}
    request_headers.update(headers or {})
    for attempt in range(4):
        STATS["http_calls"] += 1
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=request_headers, method="GET"), timeout=20) as r:
                return r.status, json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < 3:
                time.sleep(2)
                continue
            return error.code, None
        except (urllib.error.URLError, OSError, ValueError) as error:
            if attempt < 3:
                time.sleep(1)
                continue
            return None, type(error).__name__


def name_of(value):
    return (value or "").lower().rstrip(".").replace("\\052", "*")


def section(report, key, function):
    """Each section stands alone: a failure is recorded and the report goes on."""
    try:
        report[key] = function()
    except Exception as exc:  # noqa: BLE001 - recorded, never printed
        note_error(f"section {key}", type(exc).__name__)
        report[key] = None


# ---------------------------------------------------------------- Terraform state (addresses and ids only)

def terraform_state():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "state.json")
        if aws("s3api", "get-object", "--bucket", STATE_BUCKET, "--key", STATE_KEY, path) is None:
            return None
        with open(path) as handle:
            state = json.load(handle)
    if state.get("lineage") != STATE_LINEAGE:
        note_error("terraform state", "unexpected lineage")
        return None
    return extract_state(state)


def extract_state(state):
    """Only the whitelisted attributes of the whitelisted resource types; state values (secrets) never leave."""
    found = []
    for resource in state.get("resources") or []:
        if resource.get("mode") != "managed" or resource.get("type") not in STATE_TYPES:
            continue
        keys = STATE_TYPES[resource["type"]]
        for instance in resource.get("instances") or []:
            attributes = instance.get("attributes") or {}
            index = instance.get("index_key")
            address = f'{resource["type"]}.{resource["name"]}' + ("" if index is None else f"[{json.dumps(index)}]")
            found.append({"address": address, **{k: attributes.get(k) for k in keys}})
    return {"serial": state.get("serial"), "resources": found}


# ---------------------------------------------------------------- Route 53

def route53():
    zones = (aws("route53", "list-hosted-zones", region=EDGE) or {}).get("HostedZones")
    if zones is None:
        return None
    out = {"zones_total": len(zones), "out_of_scope_zone_count": 0, "in_scope": {}}
    for zone in zones:
        name = name_of(zone.get("Name"))
        if name not in IN_SCOPE_ZONES:
            out["out_of_scope_zone_count"] += 1
            continue
        zone_id = zone["Id"].split("/")[-1]
        detail = aws("route53", "get-hosted-zone", "--id", zone_id, region=EDGE) or {}
        records = (aws("route53", "list-resource-record-sets", "--hosted-zone-id", zone_id, region=EDGE) or {}).get(
            "ResourceRecordSets", [])
        out["in_scope"].setdefault(name, []).append({
            "zone_id": zone_id,
            "comment": (zone.get("Config") or {}).get("Comment"),
            "private": (zone.get("Config") or {}).get("PrivateZone"),
            "record_count": zone.get("ResourceRecordSetCount"),
            "name_servers": sorted(name_of(ns) for ns in (detail.get("DelegationSet") or {}).get("NameServers", [])),
            "records": records,
        })
    return out


def untracked_records(zone_id, zone_name, live_records, state):
    """Live records Terraform does not manage (the zone's own apex NS and SOA excluded)."""
    def full_name(record):
        name = name_of(record.get("fqdn") or record.get("name"))
        return name if name == zone_name or name.endswith("." + zone_name) else f"{name}.{zone_name}"

    tracked = {
        (full_name(r), r.get("type"), r.get("set_identifier") or "")
        for r in state if r["address"].startswith("aws_route53_record.") and r.get("zone_id") == zone_id
    }
    out = []
    for record in live_records:
        key = (name_of(record.get("Name")), record.get("Type"), record.get("SetIdentifier") or "")
        if key[0] == zone_name and key[1] in ("NS", "SOA"):
            continue
        if key not in tracked:
            out.append({"name": key[0], "type": key[1], "alias": bool(record.get("AliasTarget"))})
    return out


def public_dns():
    out = {}
    for name, kind in PUBLIC_LOOKUPS:
        answers = {}
        for resolver, base in DOH_RESOLVERS.items():
            status, body = http_json(f"{base}?{urllib.parse.urlencode({'name': name, 'type': kind})}",
                                     headers={"Accept": "application/dns-json"})
            if status != 200 or not isinstance(body, dict):
                answers[resolver] = {"error": f"http {status}" if status else str(body)}
                continue
            answers[resolver] = {
                "status": body.get("Status"),
                "answers": sorted(name_of(a.get("data")) if kind == "NS" else (a.get("data") or "").lower()
                                  for a in body.get("Answer") or [] if a.get("type") in (2, 15)),
            }
        out[f"{name} {kind}"] = answers
    return out


# ---------------------------------------------------------------- CloudFront and ACM

def strip_custom_headers(config):
    """Origin custom header values (X-Origin-Verify is a secret) never enter the report; names only."""
    config = copy.deepcopy(config)
    for origin in (config.get("Origins") or {}).get("Items") or []:
        headers = origin.get("CustomHeaders") or {}
        origin["CustomHeaders"] = {"Quantity": headers.get("Quantity", 0),
                                   "Names": sorted(h.get("HeaderName") for h in headers.get("Items") or [])}
    return config


def cloudfront():
    listing = (aws("cloudfront", "list-distributions", region=EDGE) or {}).get("DistributionList") or {}
    distributions = []
    for item in listing.get("Items") or []:
        config = (aws("cloudfront", "get-distribution-config", "--id", item["Id"], region=EDGE) or {}).get(
            "DistributionConfig")
        distributions.append({
            "id": item["Id"],
            "domain_name": item.get("DomainName"),
            "status": item.get("Status"),
            "config": strip_custom_headers(config) if config else None,
        })
    functions = []
    for stage in ("LIVE", "DEVELOPMENT"):
        listed = (aws("cloudfront", "list-functions", "--stage", stage, region=EDGE) or {}).get("FunctionList") or {}
        for fn in listed.get("Items") or []:
            entry = {"name": fn.get("Name"), "stage": stage, "comment": (fn.get("FunctionConfig") or {}).get("Comment"),
                     "runtime": (fn.get("FunctionConfig") or {}).get("Runtime"), "code": None}
            if stage == "LIVE":
                with tempfile.TemporaryDirectory() as tmp:
                    path = os.path.join(tmp, "code.js")
                    if aws("cloudfront", "get-function", "--name", fn["Name"], "--stage", "LIVE", path, region=EDGE) is not None:
                        with open(path, errors="replace") as handle:
                            entry["code"] = handle.read()
            functions.append(entry)
    sources = (aws("logs", "describe-delivery-sources", region=EDGE) or {}).get("deliverySources") or []
    deliveries = (aws("logs", "describe-deliveries", region=EDGE) or {}).get("deliveries") or []
    return {
        "distribution_count": len(distributions),
        "distributions": distributions,
        "functions": functions,
        "log_delivery_sources": [{"name": s.get("name"), "service": s.get("service"), "log_type": s.get("logType"),
                                  "resources": s.get("resourceArns")} for s in sources],
        "log_deliveries": [{"source": d.get("deliverySourceName"), "destination_type": d.get("deliveryDestinationType")}
                           for d in deliveries],
    }


def acm():
    out = {}
    for region in (EDGE, REGION):
        listed = (aws("acm", "list-certificates", "--includes", ACM_KEY_TYPES, region=region) or {}).get(
            "CertificateSummaryList") or []
        certificates = []
        for summary in listed:
            cert = (aws("acm", "describe-certificate", "--certificate-arn", summary["CertificateArn"], region=region)
                    or {}).get("Certificate") or {}
            certificates.append({
                "arn": summary["CertificateArn"],
                "domain_name": cert.get("DomainName"),
                "subject_alternative_names": cert.get("SubjectAlternativeNames"),
                "status": cert.get("Status"),
                "type": cert.get("Type"),
                "in_use_by": cert.get("InUseBy"),
                "not_after": cert.get("NotAfter"),
                "renewal_eligibility": cert.get("RenewalEligibility"),
                "validation": [{"domain": v.get("DomainName"), "status": v.get("ValidationStatus"),
                                "method": v.get("ValidationMethod"), "record": v.get("ResourceRecord")}
                               for v in cert.get("DomainValidationOptions") or []],
            })
        quotas = (aws("service-quotas", "list-service-quotas", "--service-code", "acm", region=region) or {}).get(
            "Quotas") or []
        out[region] = {
            "certificates": certificates,
            "quotas": [{"name": q.get("QuotaName"), "value": q.get("Value"), "code": q.get("QuotaCode")} for q in quotas],
        }
    return out


# ---------------------------------------------------------------- Cognito, SES, Lambda, ECS

def cognito():
    pools = (aws("cognito-idp", "list-user-pools", "--max-results", "60") or {}).get("UserPools") or []
    pool = next((p for p in pools if p.get("Name") == PREFIX + "-users"), None)
    if not pool:
        note_error("cognito", "user pool not found")
        return None
    pool_id = pool["Id"]
    described = (aws("cognito-idp", "describe-user-pool", "--user-pool-id", pool_id) or {}).get("UserPool") or {}
    domains = {}
    for kind in ("Domain", "CustomDomain"):
        if described.get(kind):
            detail = (aws("cognito-idp", "describe-user-pool-domain", "--domain", described[kind]) or {}).get(
                "DomainDescription") or {}
            domains[kind] = {"domain": described[kind], "status": detail.get("Status"),
                             "cloudfront": detail.get("CloudFrontDistribution"),
                             "certificate": (detail.get("CustomDomainConfig") or {}).get("CertificateArn"),
                             "managed_login_version": detail.get("ManagedLoginVersion")}
    clients = []
    for client in (aws("cognito-idp", "list-user-pool-clients", "--user-pool-id", pool_id, "--max-results", "60")
                   or {}).get("UserPoolClients") or []:
        detail = (aws("cognito-idp", "describe-user-pool-client", "--user-pool-id", pool_id, "--client-id",
                      client["ClientId"]) or {}).get("UserPoolClient") or {}
        clients.append({k: detail.get(k) for k in ("ClientName", "CallbackURLs", "LogoutURLs", "DefaultRedirectURI",
                                                  "SupportedIdentityProviders", "AllowedOAuthFlows",
                                                  "AllowedOAuthScopes")})
    providers = []
    for provider in (aws("cognito-idp", "list-identity-providers", "--user-pool-id", pool_id, "--max-results", "60")
                     or {}).get("Providers") or []:
        detail = (aws("cognito-idp", "describe-identity-provider", "--user-pool-id", pool_id, "--provider-name",
                      provider["ProviderName"]) or {}).get("IdentityProvider") or {}
        providers.append({
            "name": detail.get("ProviderName"),
            "type": detail.get("ProviderType"),
            "details": {k: v for k, v in (detail.get("ProviderDetails") or {}).items() if k in IDP_DETAIL_KEYS},
            "attribute_mapping_keys": sorted((detail.get("AttributeMapping") or {}).keys()),
        })
    return {
        "domains": domains,
        "mfa": described.get("MfaConfiguration"),
        "lambda_triggers": sorted((described.get("LambdaConfig") or {}).keys()),
        "email_configuration": described.get("EmailConfiguration"),
        "verification_message_template": described.get("VerificationMessageTemplate"),
        "admin_create_user_invite_template": ((described.get("AdminCreateUserConfig") or {}).get("InviteMessageTemplate")),
        "estimated_users": described.get("EstimatedNumberOfUsers"),
        "clients": clients,
        "identity_providers": providers,
    }


def ses():
    identities = []
    for identity in (aws("sesv2", "list-email-identities") or {}).get("EmailIdentities") or []:
        name = identity.get("IdentityName")
        detail = aws("sesv2", "get-email-identity", "--email-identity", name) or {}
        identities.append({
            "name": name,
            "type": identity.get("IdentityType"),
            "verified_for_sending": detail.get("VerifiedForSendingStatus"),
            "verification_status": detail.get("VerificationStatus"),
            "dkim": {k: (detail.get("DkimAttributes") or {}).get(k) for k in ("Status", "SigningEnabled",
                                                                             "SigningAttributesOrigin", "Tokens")},
            "mail_from": detail.get("MailFromAttributes"),
            "configuration_set": detail.get("ConfigurationSetName"),
        })
    account = aws("sesv2", "get-account") or {}
    points = (aws("ses", "get-send-statistics") or {}).get("SendDataPoints") or []
    return {
        "identities": identities,
        "sending_enabled": account.get("SendingEnabled"),
        "production_access": account.get("ProductionAccessEnabled"),
        "send_quota": account.get("SendQuota"),
        "last_14_days": {k: sum(int(p.get(k) or 0) for p in points)
                         for k in ("DeliveryAttempts", "Bounces", "Complaints", "Rejects")},
    }


def picked_env(variables):
    """Configuration values by name, plus any other value that names one of our domains; never secrets."""
    out = {}
    for key, value in (variables or {}).items():
        if key in ENV_KEYS or (isinstance(value, str) and re.search(r"seanshore|seaandshore|cloudfront\.net", value)
                               and not re.search(r"SECRET|TOKEN|KEY|PASSWORD", key)):
            out[key] = value
    return out


def lambdas():
    out = []
    for fn in (aws("lambda", "list-functions") or {}).get("Functions") or []:
        name = fn.get("FunctionName") or ""
        if not name.startswith(PREFIX) or not LAMBDA_NAMES.search(name):
            continue
        detail = aws("lambda", "get-function-configuration", "--function-name", name) or {}
        out.append({"name": name, "environment": picked_env((detail.get("Environment") or {}).get("Variables"))})
    return out


def ecs():
    out = []
    for cluster in (aws("ecs", "list-clusters") or {}).get("clusterArns") or []:
        if PREFIX not in cluster:
            continue
        services = (aws("ecs", "list-services", "--cluster", cluster) or {}).get("serviceArns") or []
        for i in range(0, len(services), 10):
            described = (aws("ecs", "describe-services", "--cluster", cluster, "--services", *services[i:i + 10])
                         or {}).get("services") or []
            for service in described:
                task = (aws("ecs", "describe-task-definition", "--task-definition", service.get("taskDefinition"))
                        or {}).get("taskDefinition") or {}
                out.append({
                    "service": service.get("serviceName"),
                    "task_definition": (service.get("taskDefinition") or "").split("/")[-1],
                    "containers": [{"name": c.get("name"),
                                    "environment": picked_env({e.get("name"): e.get("value") for e in c.get("environment") or []})}
                                   for c in task.get("containerDefinitions") or []],
                })
    return out


# ---------------------------------------------------------------- S3, API Gateway, WAF

def s3():
    buckets = [b.get("Name") for b in (aws("s3api", "list-buckets") or {}).get("Buckets") or []
               if (b.get("Name") or "").startswith("sea-n-shore")]
    cors = {}
    for bucket in buckets:
        rules = aws("s3api", "get-bucket-cors", "--bucket", bucket, quiet=True)
        cors[bucket] = (rules or {}).get("CORSRules")
    report_bucket = {
        "public_access_block": (aws("s3api", "get-public-access-block", "--bucket", REPORT_BUCKET) or {}).get(
            "PublicAccessBlockConfiguration"),
        "encryption": (aws("s3api", "get-bucket-encryption", "--bucket", REPORT_BUCKET) or {}).get(
            "ServerSideEncryptionConfiguration"),
        "versioning": (aws("s3api", "get-bucket-versioning", "--bucket", REPORT_BUCKET) or {}).get("Status"),
        "lifecycle_rules": (aws("s3api", "get-bucket-lifecycle-configuration", "--bucket", REPORT_BUCKET) or {}).get(
            "Rules"),
    }
    return {"bucket_count": len(buckets), "cors": cors, "report_bucket": report_bucket}


def api_gateway():
    apis = (aws("apigatewayv2", "get-apis") or {}).get("Items") or []
    return {
        "v2_domain_names": [d.get("DomainName") for d in (aws("apigatewayv2", "get-domain-names") or {}).get("Items") or []],
        "v1_domain_names": [d.get("domainName") for d in (aws("apigateway", "get-domain-names") or {}).get("items") or []],
        "apis": [{"name": a.get("Name"), "protocol": a.get("ProtocolType"), "endpoint": a.get("ApiEndpoint"),
                  "cors": a.get("CorsConfiguration")} for a in apis],
    }


def match_kinds(statement):
    """The request parts a WAF statement matches on (UriPath, SingleHeader:host, ...), values left out."""
    kinds = []
    if isinstance(statement, dict):
        for key, value in statement.items():
            if key == "FieldToMatch" and isinstance(value, dict):
                for part, detail in value.items():
                    header = (detail or {}).get("Name") if isinstance(detail, dict) else None
                    kinds.append(f"{part}:{header.lower()}" if header else part)
            else:
                kinds.extend(match_kinds(value))
    elif isinstance(statement, list):
        for value in statement:
            kinds.extend(match_kinds(value))
    return kinds


def waf():
    out = []
    for scope, region in (("CLOUDFRONT", EDGE), ("REGIONAL", REGION)):
        for acl in (aws("wafv2", "list-web-acls", "--scope", scope, region=region) or {}).get("WebACLs") or []:
            detail = (aws("wafv2", "get-web-acl", "--scope", scope, "--name", acl["Name"], "--id", acl["Id"],
                          region=region) or {}).get("WebACL") or {}
            rules = [{"name": r.get("Name"), "priority": r.get("Priority"),
                      "matches": sorted(set(match_kinds(r.get("Statement"))))} for r in detail.get("Rules") or []]
            out.append({"scope": scope, "name": acl.get("Name"), "rules": rules,
                        "host_header_rules": sum(1 for r in rules if any(m == "SingleHeader:host" for m in r["matches"]))})
    return out


# ---------------------------------------------------------------- Database (counts only)

def run_count(arn, secret, statement):
    """One SELECT in its own READ ONLY transaction, rolled back; returns the first row's numbers."""
    assert re.match(r"^\s*(select|with)\b", statement, re.I)
    base = ["--resource-arn", arn, "--secret-arn", secret, "--database", DATABASE]
    tx = aws("rds-data", "begin-transaction", *base)
    if not tx:
        return None
    txid = tx["transactionId"]
    try:
        aws("rds-data", "execute-statement", *base, "--transaction-id", txid, "--sql", "SET TRANSACTION READ ONLY")
        aws("rds-data", "execute-statement", *base, "--transaction-id", txid, "--sql", "SET LOCAL statement_timeout = '30s'")
        STATS["sql_statements"] += 1
        result = aws("rds-data", "execute-statement", *base, "--transaction-id", txid, "--sql", statement)
        if not result:
            return None
        return [list(cell.values())[0] for cell in (result.get("records") or [[]])[0]]
    finally:
        aws("rds-data", "rollback-transaction", "--resource-arn", arn, "--secret-arn", secret, "--transaction-id", txid)


def count_statement(table):
    assert re.fullmatch(r"[a-z_]+", table)
    filters = ", ".join(f"count(*) filter (where t::text ~* '{pattern}')" for pattern in DB_PATTERNS.values())
    return f"select count(*), {filters} from public.{table} t"


def database():
    cluster = ((aws("rds", "describe-db-clusters", "--db-cluster-identifier", CLUSTER_ID) or {}).get("DBClusters")
               or [{}])[0]
    arn, secret = cluster.get("DBClusterArn"), (cluster.get("MasterUserSecret") or {}).get("SecretArn")
    if not arn or not secret:
        note_error("database", "no Data API cluster or secret")
        return None
    listed = ", ".join(f"'{t}'" for t in DB_COUNT_TABLES)
    existing = run_count(arn, secret, "select string_agg(table_name, ',' order by table_name) from information_schema.tables "
                                      f"where table_schema = 'public' and table_name in ({listed})")
    present = set(existing[0].split(",")) if existing and isinstance(existing[0], str) else set()
    out = {"note": "information only: rows that mention an old domain; member content is not rewritten", "tables": {}}
    for table in DB_COUNT_TABLES:
        if table not in present:
            out["tables"][table] = "absent"
            continue
        row = run_count(arn, secret, count_statement(table))
        out["tables"][table] = None if row is None else dict(zip(["rows", *DB_PATTERNS.keys()], row))
    return out


# ---------------------------------------------------------------- Resend (GETs with the admin key)

def resend_admin_key():
    key = aws("secretsmanager", "get-secret-value", "--secret-id", RESEND_ADMIN_SECRET, "--query", "SecretString")
    if not isinstance(key, str) or not key.startswith("re_") or any(c.isspace() for c in key):
        note_error("resend", "admin key unreadable or malformed")
        return None
    return key


def resend():
    key = resend_admin_key()
    if not key:
        return None
    auth = {"Authorization": "Bearer " + key}
    status, listing = http_json(RESEND_API + "/domains", headers=auth)
    if status != 200 or not isinstance(listing, dict):
        note_error("resend GET /domains", f"http {status}")
        return None
    domains = {d.get("name"): d for d in listing.get("data") or []}
    out = {"domain_count": len(domains), "domains": {}}
    for name in RESEND_DOMAINS:
        summary = domains.get(name)
        if not summary:
            out["domains"][name] = "absent"
            continue
        status, detail = http_json(RESEND_API + "/domains/" + urllib.parse.quote(summary["id"], safe=""), headers=auth)
        if status != 200 or not isinstance(detail, dict):
            note_error(f"resend GET /domains/{name}", f"http {status}")
            detail = {}
        out["domains"][name] = {
            "id": summary.get("id"),
            "status": detail.get("status", summary.get("status")),
            "region": detail.get("region", summary.get("region")),
            "created_at": summary.get("created_at"),
            "capabilities": detail.get("capabilities"),
            "records": [{k: r.get(k) for k in ("record", "name", "type", "ttl", "status", "value", "priority")}
                        for r in detail.get("records") or []],
        }
    return out


def receiving_mx(report):
    """Does mail.seanshore.in receive mail (an MX at mail.seanshore.in itself, not the send.mail return path)?"""
    found = {"route53": False, "resend": False}
    for zone in ((report.get("route53") or {}).get("in_scope") or {}).get("seanshore.in") or []:
        found["route53"] = found["route53"] or any(
            name_of(r.get("Name")) == "mail.seanshore.in" and r.get("Type") == "MX" for r in zone["records"])
    domain = ((report.get("resend") or {}).get("domains") or {}).get("mail.seanshore.in")
    if isinstance(domain, dict):
        found["resend"] = any(r.get("type") == "MX" and (r.get("record") or "").upper() != "SPF"
                              for r in domain.get("records") or [])
    return found


# ---------------------------------------------------------------- summary, upload

def summary(report):
    r53 = (report.get("route53") or {}).get("in_scope") or {}
    state = (report.get("terraform_state") or {}).get("resources") or []
    state_zone_ids = {r.get("zone_id") for r in state if r["address"].startswith("aws_route53_zone.")}
    state_distributions = {r.get("id") for r in state if r["address"].startswith("aws_cloudfront_distribution.")}
    dns = report.get("public_dns") or {}
    zones = {}
    for name in IN_SCOPE_ZONES:
        found = r53.get(name) or []
        entry = {"zone_count": len(found)}
        if len(found) == 1:
            zone = found[0]
            answers = dns.get(f"{name} NS") or {}
            entry.update({
                "zone_id": zone["zone_id"],
                "in_terraform": zone["zone_id"] in state_zone_ids,
                "records": len(zone["records"]),
                "untracked_records": untracked_records(zone["zone_id"], name, zone["records"], state),
                "delegation_matches": {resolver: (a.get("answers") == zone["name_servers"]) if "answers" in a else None
                                       for resolver, a in answers.items()},
            })
        zones[name] = entry
    distributions = (report.get("cloudfront") or {}).get("distributions") or []
    return {
        "zones": zones,
        "seanshore_net_zone_count": len(r53.get("seanshore.net") or []),
        "distributions_total": len(distributions),
        "distributions_not_in_terraform": [
            {"id": d["id"], "aliases": ((d.get("config") or {}).get("Aliases") or {}).get("Items")}
            for d in distributions if d["id"] not in state_distributions],
        "mail_seanshore_in_receiving_mx": receiving_mx(report),
        "errors": len(ERRORS),
    }


def upload(body, key):
    """The one write: a new object (never an overwrite) under private-reports/domain-move/, SSE-S3."""
    assert key.startswith(REPORT_PREFIX) and re.fullmatch(r"[a-z0-9/._-]+", key)
    if aws("s3api", "head-object", "--bucket", REPORT_BUCKET, "--key", key, quiet=True) is not None:
        return "exists"
    with tempfile.NamedTemporaryFile("wb", suffix=".json", delete=False) as handle:
        handle.write(body)
        path = handle.name
    try:
        os.chmod(path, 0o600)
        done = subprocess.run(["aws", "s3api", "put-object", "--bucket", REPORT_BUCKET, "--key", key, "--body", path,
                               "--server-side-encryption", "AES256", "--content-type", "application/json",
                               "--region", REGION, "--output", "json"], text=True, capture_output=True, timeout=120)
    finally:
        os.unlink(path)
    if done.returncode != 0:
        return "access-denied" if "AccessDenied" in done.stderr else "failed"
    head = aws("s3api", "head-object", "--bucket", REPORT_BUCKET, "--key", key) or {}
    if head.get("ServerSideEncryption") != "AES256" or int(head.get("ContentLength") or -1) != len(body):
        return "unverified"
    return "ok"


def main():
    sha = os.environ.get("DOMAIN_MOVE_REPORT_EXPECTED_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        print("DOMAIN_MOVE_REPORT=FAIL stage=config")
        return 1
    report = {
        "report": "domain-move phase 0 (read only)",
        "commit": sha,
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "in_scope_zones": IN_SCOPE_ZONES,
    }
    section(report, "terraform_state", terraform_state)
    section(report, "route53", route53)
    section(report, "public_dns", public_dns)
    section(report, "cloudfront", cloudfront)
    section(report, "acm", acm)
    section(report, "cognito", cognito)
    section(report, "ses", ses)
    section(report, "lambda", lambdas)
    section(report, "ecs", ecs)
    section(report, "s3", s3)
    section(report, "api_gateway", api_gateway)
    section(report, "waf", waf)
    section(report, "database_counts", database)
    section(report, "resend", resend)
    section(report, "summary", lambda: summary(report))
    report["errors"] = ERRORS
    report["stats"] = STATS
    body = json.dumps(report, indent=2, sort_keys=True, default=str).encode()
    digest = hashlib.sha256(body).hexdigest()
    result = upload(body, f"{REPORT_PREFIX}phase0-{sha}.json")
    if result != "ok":
        print(f"DOMAIN_MOVE_REPORT=FAIL stage=put-object result={result}")
        return 1
    print(f"DOMAIN_MOVE_REPORT_SHA256={digest}")
    print("DOMAIN_MOVE_REPORT=PASS")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001 - the public log gets the stage only
        print("DOMAIN_MOVE_REPORT=FAIL stage=unexpected")
        sys.exit(1)
