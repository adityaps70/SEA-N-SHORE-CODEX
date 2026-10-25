#!/usr/bin/env python3
"""Round P3 (B9): install the pg_stat_statements extension on the staging (production) Aurora cluster.

Runs on the bootstrap host through SSM. Aurora PostgreSQL normally preloads the library, so installing
is one CREATE EXTENSION with no reboot. If the cluster does not preload it, this changes nothing and
reports PGSS_REBOOT_REQUIRED: the parameter group change and reboot are a separate, night-time step.
SQL goes through the RDS Data API. The only statement that changes anything is
CREATE EXTENSION IF NOT EXISTS pg_stat_statements; output is versions and counts, never query text.
"""
import json
import os
import re
import subprocess
import sys

REGION = os.environ.get("AWS_REGION", "ap-south-1")
CLUSTER_ID = "sea-n-shore-staging-aurora"
DATABASE = "sea_n_shore"
INSTALL = os.environ.get("PGSS_ACTION") == "install"

READ_STATEMENTS = (
    "show shared_preload_libraries",
    "select extversion from pg_extension where extname = 'pg_stat_statements'",
    "select count(*) as statements from pg_stat_statements",
)
INSTALL_STATEMENT = "create extension if not exists pg_stat_statements"


def out(*parts):
    print(" ".join(str(p) for p in parts), flush=True)


def aws(service, action, *args):
    p = subprocess.run(["aws", service, action, *[str(a) for a in args], "--region", REGION, "--output", "json"],
                       text=True, capture_output=True, timeout=300)
    if p.returncode != 0:
        reason = re.sub(r"arn:aws:\S+", "[ARN]", p.stderr.strip().splitlines()[-1] if p.stderr.strip() else "failed")
        raise SystemExit("AWS %s %s failed: %s" % (service, action, reason[:200]))
    return json.loads(p.stdout) if p.stdout.strip() else {}


def connection():
    c = aws("rds", "describe-db-clusters", "--db-cluster-identifier", CLUSTER_ID)["DBClusters"][0]
    arn, secret = c.get("DBClusterArn"), (c.get("MasterUserSecret") or {}).get("SecretArn")
    assert arn and secret and c.get("HttpEndpointEnabled"), "the cluster must have the Data API and a managed master secret"
    return ["--resource-arn", arn, "--secret-arn", secret, "--database", DATABASE]


def sql(base, statement):
    assert statement in READ_STATEMENTS or statement == INSTALL_STATEMENT, "unexpected statement"
    r = aws("rds-data", "execute-statement", *base, "--sql", statement, "--format-records-as", "JSON")
    return json.loads(r["formattedRecords"]) if r.get("formattedRecords") else []


def main():
    base = connection()
    preload = (sql(base, READ_STATEMENTS[0]) or [{}])[0].get("shared_preload_libraries", "")
    preloaded = "pg_stat_statements" in [part.strip() for part in preload.split(",")]
    installed = sql(base, READ_STATEMENTS[1])
    out("PGSS_PRELOADED=%s" % str(preloaded).lower())
    out("PGSS_INSTALLED_BEFORE=%s" % (installed[0]["extversion"] if installed else "none"))
    if not preloaded:
        out("PGSS_REBOOT_REQUIRED=true (shared_preload_libraries does not include pg_stat_statements; nothing changed)")
        return 3
    if not INSTALL:
        out("PGSS_PLAN_ONLY_NO_CHANGE")
        return 0
    if not installed:
        sql(base, INSTALL_STATEMENT)
    after = sql(base, READ_STATEMENTS[1])
    assert after, "pg_stat_statements is not installed after CREATE EXTENSION"
    tracked = (sql(base, READ_STATEMENTS[2]) or [{}])[0].get("statements")
    out("PGSS_INSTALLED_AFTER=%s" % after[0]["extversion"])
    out("PGSS_TRACKED_STATEMENTS=%s" % tracked)
    out("PGSS_INSTALL_VERIFIED=true (no reboot)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
