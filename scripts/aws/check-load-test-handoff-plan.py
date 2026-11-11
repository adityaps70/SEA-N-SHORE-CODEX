#!/usr/bin/env python3
"""Round ARCH (signed-in load test): checks a targeted Terraform plan for the S3 hand-off (load-test-handoff.tf).

  check-load-test-handoff-plan.py PLAN_JSON
      Prints LOAD_TEST_HANDOFF_PLAN=NO_CHANGES, or LOAD_TEST_HANDOFF_PLAN=CREATE plus one line per resource, and exits 0
      only if the plan creates exactly the approved resources with exactly the approved settings (or changes nothing).
  check-load-test-handoff-plan.py --key-policy GITHUB_ROLE_ARN < POLICY_JSON
      Prints true if a live key policy is exactly the approved one, else false.
"""
import json
import sys

ACCOUNT = "310356785722"
REGION = "ap-south-1"
BUCKET = "sea-n-shore-staging-310356785722-load-test-handoff"
BUCKET_ARN = f"arn:aws:s3:::{BUCKET}"
TASK_ROLE_ARN = f"arn:aws:iam::{ACCOUNT}:role/sea-n-shore-staging-ecs-task"
GITHUB_ROLE_ARN = f"arn:aws:iam::{ACCOUNT}:role/sea-n-shore-staging-github-deploy"
CONTEXTS = [BUCKET_ARN, f"{BUCKET_ARN}/sessions/*"]
ADMIN_ACTIONS = sorted([
    "kms:CreateAlias", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*", "kms:Update*", "kms:Revoke*",
    "kms:Disable*", "kms:Get*", "kms:Delete*", "kms:TagResource", "kms:UntagResource",
    "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
])
ALLOWED = {
    "aws_kms_key.load_test_handoff",
    "aws_kms_alias.load_test_handoff",
    "aws_s3_bucket.load_test_handoff",
    "aws_s3_bucket_public_access_block.load_test_handoff",
    "aws_s3_bucket_ownership_controls.load_test_handoff",
    "aws_s3_bucket_server_side_encryption_configuration.load_test_handoff",
    "aws_s3_bucket_lifecycle_configuration.load_test_handoff",
    "aws_s3_bucket_policy.load_test_handoff",
    "aws_iam_role_policy.ecs_task_load_test_handoff",
}


def as_list(value):
    return value if isinstance(value, list) else [value]


def normal(statement):
    """A statement with Action, Resource and condition values as sorted lists, so equal policies compare equal."""
    out = dict(statement)
    for field in ("Action", "Resource"):
        if field in out:
            out[field] = sorted(as_list(out[field]))
    if "Principal" in out and isinstance(out["Principal"], dict):
        out["Principal"] = {k: sorted(as_list(v)) for k, v in out["Principal"].items()}
    if "Condition" in out:
        out["Condition"] = {op: {k: sorted(as_list(v)) for k, v in body.items()} for op, body in out["Condition"].items()}
    return out


def expected_key_policy(github_role_arn=GITHUB_ROLE_ARN):
    via = {"StringEquals": {"kms:ViaService": f"s3.{REGION}.amazonaws.com"}, "StringLike": {"kms:EncryptionContext:aws:s3:arn": CONTEXTS}}
    return [normal(s) for s in [
        {"Sid": "AccountAdministersButCannotUse", "Effect": "Allow", "Principal": {"AWS": f"arn:aws:iam::{ACCOUNT}:root"}, "Action": ADMIN_ACTIONS, "Resource": "*"},
        {"Sid": "SessionsTaskEncryptsThroughS3", "Effect": "Allow", "Principal": {"AWS": TASK_ROLE_ARN}, "Action": ["kms:GenerateDataKey"], "Resource": "*", "Condition": via},
        {"Sid": "RunnerDecryptsThroughS3", "Effect": "Allow", "Principal": {"AWS": github_role_arn}, "Action": ["kms:Decrypt"], "Resource": "*", "Condition": via},
    ]]


def key_policy_ok(policy, github_role_arn=GITHUB_ROLE_ARN):
    statements = sorted((normal(s) for s in policy.get("Statement", [])), key=lambda s: s.get("Sid", ""))
    return statements == sorted(expected_key_policy(github_role_arn), key=lambda s: s["Sid"])


EXPECTED_BUCKET_POLICY = sorted([normal(s) for s in [
    {"Sid": "DenyInsecureTransport", "Effect": "Deny", "Principal": "*", "Action": "s3:*", "Resource": [BUCKET_ARN, f"{BUCKET_ARN}/*"],
     "Condition": {"Bool": {"aws:SecureTransport": "false"}}},
    {"Sid": "DenyOwnEncryptionHeaders", "Effect": "Deny", "Principal": "*", "Action": "s3:PutObject", "Resource": f"{BUCKET_ARN}/*",
     "Condition": {"Null": {"s3:x-amz-server-side-encryption": "false"}}},
    {"Sid": "DenyCustomerKeys", "Effect": "Deny", "Principal": "*", "Action": "s3:PutObject", "Resource": f"{BUCKET_ARN}/*",
     "Condition": {"Null": {"s3:x-amz-server-side-encryption-customer-algorithm": "false"}}},
]], key=lambda s: s["Sid"])
EXPECTED_TASK_POLICY = [normal({"Sid": "WriteSealedLoadTestSessions", "Effect": "Allow", "Action": ["s3:PutObject"], "Resource": f"{BUCKET_ARN}/sessions/*"})]


def policy_statements(text):
    if not isinstance(text, str):
        return None
    return sorted((normal(s) for s in json.loads(text).get("Statement", [])), key=lambda s: s.get("Sid", ""))


def check_create(address, after, errors):
    """The approved settings of each new resource (values known at plan time)."""
    if address == "aws_kms_key.load_test_handoff":
        if after.get("enable_key_rotation") is not True or after.get("deletion_window_in_days") != 7:
            errors.append("The key must rotate and have a 7-day deletion window")
        if after.get("customer_master_key_spec") not in (None, "SYMMETRIC_DEFAULT") or after.get("key_usage") not in (None, "ENCRYPT_DECRYPT"):
            errors.append("The key must be a symmetric encrypt/decrypt key")
        policy = after.get("policy")
        if not isinstance(policy, str) or not key_policy_ok(json.loads(policy)):
            errors.append("The key policy is not the approved one")
    elif address == "aws_kms_alias.load_test_handoff":
        if after.get("name") != "alias/sea-n-shore-staging-load-test-handoff":
            errors.append("Unexpected key alias")
    elif address == "aws_s3_bucket.load_test_handoff":
        if after.get("bucket") != BUCKET or after.get("force_destroy") is not False:
            errors.append("Unexpected bucket name or force_destroy")
    elif address == "aws_s3_bucket_public_access_block.load_test_handoff":
        if not all(after.get(k) is True for k in ("block_public_acls", "block_public_policy", "ignore_public_acls", "restrict_public_buckets")):
            errors.append("Public access must be blocked in full")
    elif address == "aws_s3_bucket_ownership_controls.load_test_handoff":
        if [r.get("object_ownership") for r in after.get("rule", [])] != ["BucketOwnerEnforced"]:
            errors.append("Objects must be owner-enforced")
    elif address == "aws_s3_bucket_server_side_encryption_configuration.load_test_handoff":
        rules = after.get("rule", [])
        defaults = [d for r in rules for d in r.get("apply_server_side_encryption_by_default", [])]
        if len(rules) != 1 or rules[0].get("bucket_key_enabled") is not True or [d.get("sse_algorithm") for d in defaults] != ["aws:kms"]:
            errors.append("Default encryption must be SSE-KMS with a bucket key")
    elif address == "aws_s3_bucket_lifecycle_configuration.load_test_handoff":
        rules = after.get("rule", [])
        ok = len(rules) == 1 and rules[0].get("status") == "Enabled"
        ok = ok and [e.get("days") for e in rules[0].get("expiration", [])] == [1]
        ok = ok and [a.get("days_after_initiation") for a in rules[0].get("abort_incomplete_multipart_upload", [])] == [1]
        if not ok:
            errors.append("The lifecycle must expire objects and unfinished uploads after 1 day")
    elif address == "aws_s3_bucket_policy.load_test_handoff":
        if policy_statements(after.get("policy")) != EXPECTED_BUCKET_POLICY:
            errors.append("The bucket policy is not the approved one")
    elif address == "aws_iam_role_policy.ecs_task_load_test_handoff":
        if after.get("name") != "sea-n-shore-staging-load-test-handoff" or policy_statements(after.get("policy")) != EXPECTED_TASK_POLICY:
            errors.append("The task role may only gain s3:PutObject on sessions/*")


def classify(plan):
    errors, created = [], []
    for change in plan.get("resource_changes", []):
        if change.get("mode") == "data":
            continue
        address, actions = change["address"], change["change"]["actions"]
        if actions == ["no-op"]:
            continue
        if address in ALLOWED and actions == ["create"]:
            created.append(address)
            check_create(address, change["change"].get("after") or {}, errors)
            continue
        errors.append(f"Unexpected change: {address} {actions}")
    return created, errors


def main(argv):
    if len(argv) == 3 and argv[1] == "--key-policy":
        try:
            print("true" if key_policy_ok(json.loads(sys.stdin.read()), argv[2]) else "false")
        except (ValueError, AttributeError):
            print("false")
        return 0
    with open(argv[1]) as handle:
        plan = json.load(handle)
    created, errors = classify(plan)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    if not created:
        print("LOAD_TEST_HANDOFF_PLAN=NO_CHANGES")
        return 0
    print("LOAD_TEST_HANDOFF_PLAN=CREATE")
    for address in sorted(created):
        print(f"LOAD_TEST_HANDOFF_CREATE={address}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
