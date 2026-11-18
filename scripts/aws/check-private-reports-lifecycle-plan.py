#!/usr/bin/env python3
"""Private reports (owner-approved 17 Nov): checks the targeted plan for the migration bucket's lifecycle rules.

  check-private-reports-lifecycle-plan.py PLAN_JSON
      Prints PRIVATE_REPORTS_LIFECYCLE_PLAN=NO_CHANGES, or PRIVATE_REPORTS_LIFECYCLE_PLAN=ADD_RULE, and exits 0 only if
      the plan touches nothing but aws_s3_bucket_lifecycle_configuration.migration_backup, in place, going from exactly
      the existing rule to the existing rule plus the approved private-reports/ rule (or is already there).
  check-private-reports-lifecycle-plan.py --live < LIFECYCLE_JSON
      Prints true if the bucket's live lifecycle rules (s3api get-bucket-lifecycle-configuration) are exactly the
      approved two, else false.

Prints the classification only: no bucket contents, no state values.
"""
import json
import sys

ADDRESS = "aws_s3_bucket_lifecycle_configuration.migration_backup"
BUCKET = "sea-n-shore-staging-310356785722-migration"
PREFIX = "private-reports/"
RULE_ID = "expire-private-reports-after-14-days"

EXISTING_RULE = {
    "id": "abort-incomplete-multipart",
    "status": "Enabled",
    "abort_incomplete_multipart_upload": [{"days_after_initiation": 7}],
}
REPORTS_RULE = {
    "id": RULE_ID,
    "status": "Enabled",
    "filter": [{"prefix": PREFIX}],
    "expiration": [{"days": 14}],
    "noncurrent_version_expiration": [{"noncurrent_days": 1}],
}


def compact(value):
    """Drops empty and default values (None, "", 0, False, [], {}) so provider defaults compare equal."""
    if isinstance(value, dict):
        out = {k: compact(v) for k, v in value.items()}
        return {k: v for k, v in out.items() if v not in (None, "", 0, False, [], {})}
    if isinstance(value, list):
        out = [compact(v) for v in value]
        return [v for v in out if v not in (None, "", 0, False, [], {})]
    return value


def rules(values):
    found = [compact(rule) for rule in (values or {}).get("rule") or []]
    return sorted(found, key=lambda rule: rule.get("id", ""))


EXPECTED_BEFORE = [compact(EXISTING_RULE)]
EXPECTED_AFTER = sorted([compact(EXISTING_RULE), compact(REPORTS_RULE)], key=lambda rule: rule["id"])


def fail(message):
    print(f"PRIVATE_REPORTS_LIFECYCLE_PLAN_REFUSED {message}")
    sys.exit(1)


def check_plan(plan):
    changes = [c for c in plan.get("resource_changes") or [] if c.get("mode") != "data"]
    changed = [c for c in changes if c.get("change", {}).get("actions") != ["no-op"]]
    for change in changed:
        if change.get("address") != ADDRESS:
            fail(f"unexpected={change.get('address')}")
    if not changed:
        if not any(c.get("address") == ADDRESS for c in changes):
            fail("the lifecycle configuration is not in the plan")
        after = next(c for c in changes if c.get("address") == ADDRESS)["change"].get("after")
        if rules(after) != EXPECTED_AFTER:
            fail("no change, but the rules are not the approved two")
        print("PRIVATE_REPORTS_LIFECYCLE_PLAN=NO_CHANGES")
        return
    if len(changed) != 1:
        fail(f"changes={len(changed)}")
    change = changed[0]["change"]
    if change.get("actions") != ["update"]:
        fail(f"actions={'+'.join(change.get('actions') or [])}")
    before, after = change.get("before") or {}, change.get("after") or {}
    if before.get("bucket") != BUCKET or after.get("bucket") != BUCKET:
        fail("wrong bucket")
    if rules(before) != EXPECTED_BEFORE:
        fail("the existing rules are not the expected abort-incomplete-multipart rule alone")
    if rules(after) != EXPECTED_AFTER:
        fail("the planned rules are not the existing rule plus the approved private-reports/ rule")
    # Nothing but the rule list may change.
    unknown = change.get("after_unknown") or {}
    for key in set(before) | set(after):
        if key in ("rule", "id"):
            continue
        if compact(before.get(key)) != compact(after.get(key)) and not unknown.get(key):
            fail(f"attribute={key}")
    print("PRIVATE_REPORTS_LIFECYCLE_PLAN=ADD_RULE")


def live_rules(data):
    """s3api rules (Filter/Expiration/...) in the plan's shape."""
    out = []
    for rule in (data or {}).get("Rules") or []:
        shaped = {
            "id": rule.get("ID"),
            "status": rule.get("Status"),
            "filter": [{"prefix": (rule.get("Filter") or {}).get("Prefix") or rule.get("Prefix")}],
            "expiration": [{"days": (rule.get("Expiration") or {}).get("Days")}],
            "noncurrent_version_expiration": [
                {"noncurrent_days": (rule.get("NoncurrentVersionExpiration") or {}).get("NoncurrentDays")}
            ],
            "abort_incomplete_multipart_upload": [
                {"days_after_initiation": (rule.get("AbortIncompleteMultipartUpload") or {}).get("DaysAfterInitiation")}
            ],
        }
        extra = set(rule) - {"ID", "Status", "Filter", "Prefix", "Expiration", "NoncurrentVersionExpiration",
                             "AbortIncompleteMultipartUpload"}
        if extra or set((rule.get("Filter") or {})) - {"Prefix"}:
            shaped["unexpected"] = sorted(extra | set((rule.get("Filter") or {})) - {"Prefix"})
        for block, allowed in (("Expiration", {"Days"}), ("NoncurrentVersionExpiration", {"NoncurrentDays"}),
                               ("AbortIncompleteMultipartUpload", {"DaysAfterInitiation"})):
            if set(rule.get(block) or {}) - allowed:
                shaped["unexpected_" + block] = True
        out.append(compact(shaped))
    return sorted(out, key=lambda rule: rule.get("id", ""))


def main(argv):
    if len(argv) == 2 and argv[1] == "--live":
        try:
            data = json.load(sys.stdin)
        except ValueError:
            print("false")
            return
        print("true" if live_rules(data) == EXPECTED_AFTER else "false")
        return
    if len(argv) != 2:
        fail("usage")
    with open(argv[1]) as handle:
        check_plan(json.load(handle))


if __name__ == "__main__":
    main(sys.argv)
