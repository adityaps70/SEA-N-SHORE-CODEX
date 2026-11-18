#!/usr/bin/env python3
"""Round GP (Global Partners): the read-only production counts behind Admin › Members by country.

Runs on the bootstrap host through SSM (scripts/aws/admin-filters-report.sh, report-once only). It runs the statements
in scripts/aws/admin-filters-report.sql.json (built from the app's own SQL, src/features/countries/
admin-filters-report-sql.ts) through the RDS Data API, each in its own READ ONLY transaction that is rolled back.
Every statement returns counts only; before anything is written, every value in the answers is checked to be a number,
a two-letter country code, a dialling code or a status label, and the report is refused otherwise.

The one write is a single new PutObject (never an overwrite) of the finished report to

    s3://sea-n-shore-staging-310356785722-migration/private-reports/admin-filters/counts-<sha>.json

(SSE-S3, deleted by the private-reports/ lifecycle rule after 14 days). The repository and its Actions logs are
public, so stdout carries only ADMIN_FILTERS_REPORT=PASS|FAIL, the failing stage, and the report's SHA-256.
"""
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

REGION = "ap-south-1"
PREFIX = "sea-n-shore-staging"
REPORT_BUCKET = "sea-n-shore-staging-310356785722-migration"
REPORT_PREFIX = "private-reports/admin-filters/"
CLUSTER_ID = PREFIX + "-aurora"
DATABASE = "sea_n_shore"
STATEMENTS_PATH = "scripts/aws/admin-filters-report.sql.json"
REQUIRED_MIGRATION = "0108_member_countries"
STATEMENT_NAMES = [
    "members", "members_by_country", "members_by_phone_code", "companies", "organization_applications", "jobs",
    "payments", "app_country_stats", "direct_country_counts",
]
# Every leaf value the report may hold: a count, null, '' (the page's "no country" row), a two-letter country code,
# a dialling code, a currency or currency/status, a status/kind pair, or an estimate source.
ALLOWED_TEXT = re.compile(r"^(|[A-Z]{2}|\+[0-9]{1,6}|[A-Z]{3}(/[a-z_]+)?|[a-z_]+/[a-z_]+|profile|location|phone|signup)$")
SAMPLE_COUNTRIES = 3

ERRORS = []
STATS = {"aws_calls": 0, "sql_statements": 0}


def scrub(text):
    """An error line without ARNs or account ids."""
    text = re.sub(r"arn:aws[a-z-]*:\S+", "[arn]", text or "")
    text = re.sub(r"\b[0-9]{12}\b", "[account]", text)
    return text.strip()[:240]


def note_error(where, detail):
    ERRORS.append({"where": where, "error": scrub(detail)})


def aws(service, action, *args, quiet=False):
    """One AWS CLI call; None when it fails (recorded in the report, never printed)."""
    command = ["aws", service, action, *[str(a) for a in args], "--region", REGION, "--output", "json"]
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


def run_read(arn, secret, statement):
    """One statement in its own READ ONLY transaction, always rolled back; returns the first row's cells."""
    assert re.match(r"^\s*(select|with)\b", statement, re.I)
    base = ["--resource-arn", arn, "--secret-arn", secret, "--database", DATABASE]
    tx = aws("rds-data", "begin-transaction", *base)
    if not tx:
        return None
    txid = tx["transactionId"]
    try:
        aws("rds-data", "execute-statement", *base, "--transaction-id", txid, "--sql", "SET TRANSACTION READ ONLY")
        aws("rds-data", "execute-statement", *base, "--transaction-id", txid, "--sql", "SET LOCAL statement_timeout = '60s'")
        STATS["sql_statements"] += 1
        result = aws("rds-data", "execute-statement", *base, "--transaction-id", txid, "--sql", statement)
        if not result:
            return None
        return [list(cell.values())[0] for cell in (result.get("records") or [[]])[0]]
    finally:
        aws("rds-data", "rollback-transaction", "--resource-arn", arn, "--secret-arn", secret, "--transaction-id", txid)


def load_statements():
    with open(STATEMENTS_PATH, encoding="utf-8") as handle:
        statements = json.load(handle)
    if list(statements) != STATEMENT_NAMES:
        raise ValueError("statement list changed")
    for sql in statements.values():
        if not re.match(r"^\s*(select|with)\b", sql, re.I) or re.search(r"\$[0-9]", sql) or re.search(r";\s*\S", sql):
            raise ValueError("not a single read")
    return statements


def only_counts(value):
    """True when every leaf is a number, null or an allowed code / label (keys are checked the same way)."""
    if isinstance(value, bool):
        return False
    if value is None or isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        return bool(ALLOWED_TEXT.match(value))
    if isinstance(value, list):
        return all(only_counts(item) for item in value)
    if isinstance(value, dict):
        return all((re.fullmatch(r"[a-z_0-9]+", key) or ALLOWED_TEXT.match(key)) and only_counts(item)
                   for key, item in value.items())
    return False


def sample_checks(stats, direct):
    """The page's numbers for the largest countries against direct counts: chosen members and organizations."""
    rows = sorted((row for row in stats if row.get("code")), key=lambda row: (-int(row.get("registered") or 0), row["code"]))
    checks = []
    for row in rows[:SAMPLE_COUNTRIES]:
        code = row["code"]
        chosen = int(row.get("registered") or 0) - int(row.get("estimated") or 0)
        checks.append({
            "code": code,
            "page_chosen_members": chosen,
            "direct_chosen_members": int((direct.get("chosen_members") or {}).get(code) or 0),
            "page_organizations": int(row.get("organizations") or 0),
            "direct_organizations": int((direct.get("organizations") or {}).get(code) or 0),
        })
    for check in checks:
        check["match"] = (check["page_chosen_members"] == check["direct_chosen_members"]
                          and check["page_organizations"] == check["direct_organizations"])
    return checks


def counts():
    cluster = ((aws("rds", "describe-db-clusters", "--db-cluster-identifier", CLUSTER_ID) or {}).get("DBClusters")
               or [{}])[0]
    arn, secret = cluster.get("DBClusterArn"), (cluster.get("MasterUserSecret") or {}).get("SecretArn")
    if not arn or not secret:
        return None, "database"
    applied = run_read(arn, secret, "select count(*) from public.sea_n_shore_applied_migrations "
                                    f"where name = '{REQUIRED_MIGRATION}'")
    if not applied or int(applied[0] or 0) != 1:
        return None, "migration"
    out = {}
    for name, sql in load_statements().items():
        row = run_read(arn, secret, sql)
        if not row or not isinstance(row[0], str):
            return None, "query"
        out[name] = json.loads(row[0])
    if not only_counts(out):
        return None, "content"
    out["sample_country_checks"] = sample_checks(out["app_country_stats"], out["direct_country_counts"])
    return out, None


def upload(body, key):
    """The one write: a new object (never an overwrite) under private-reports/admin-filters/, SSE-S3."""
    assert key.startswith(REPORT_PREFIX) and re.fullmatch(r"private-reports/admin-filters/[a-z0-9-]+\.json", key)
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
    sha = os.environ.get("ADMIN_FILTERS_REPORT_EXPECTED_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        print("ADMIN_FILTERS_REPORT=FAIL stage=config")
        return 1
    try:
        load_statements()
    except (OSError, ValueError):
        print("ADMIN_FILTERS_REPORT=FAIL stage=statements")
        return 1
    result, failed = counts()
    if failed:
        print(f"ADMIN_FILTERS_REPORT=FAIL stage={failed}")
        return 1
    report = {
        "report": "admin filters counts (read only, counts only)",
        "commit": sha,
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": result,
        "errors": ERRORS,
        "stats": STATS,
    }
    body = json.dumps(report, indent=2, sort_keys=True, default=str).encode()
    digest = hashlib.sha256(body).hexdigest()
    outcome = upload(body, f"{REPORT_PREFIX}counts-{sha}.json")
    if outcome != "ok":
        print(f"ADMIN_FILTERS_REPORT=FAIL stage=put-object result={outcome}")
        return 1
    print(f"ADMIN_FILTERS_REPORT_SHA256={digest}")
    print("ADMIN_FILTERS_REPORT=PASS")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001 - the public log gets the stage only
        print("ADMIN_FILTERS_REPORT=FAIL stage=unexpected")
        sys.exit(1)
