#!/usr/bin/env python3
"""Round DB (owner-approved 12 Nov): checks the targeted Terraform plan of scripts/aws/aurora-capacity-infra.sh.

  check-aurora-capacity-plan.py PLAN_JSON

Accepts only, each at most once:
  - aws_rds_cluster.aurora: an in-place update whose only change is the Serverless v2 maximum, 2 -> 4 ACU, with the
    floor kept at 0.5 ACU and deletion protection on;
  - aws_cloudwatch_metric_alarm.aurora_capacity_at_max: an in-place update of its threshold only, to 4;
  - the hourly extra-capacity check, created: its IAM role (Lambda only) and policy (read the metric, publish to the
    alerts topic, write its own logs), its log group (14 days), the Lambda (Node 22, one at a time, 2 ACU base,
    39 ACU-hour allowance), the hourly schedule, its target and invoke permission, and the alarm on its errors.
No change at all (already applied) is accepted too. Prints AURORA_CAPACITY_PLAN_CHANGES=<n> and one line per change.
"""
import json
import sys

CLUSTER = "aws_rds_cluster.aurora"
AT_MAX = "aws_cloudwatch_metric_alarm.aurora_capacity_at_max"
NAME = "sea-n-shore-staging-aurora-extra-acu-check"
CREATES = {
    "aws_iam_role.aurora_extra_acu_check",
    "aws_iam_role_policy.aurora_extra_acu_check",
    "aws_cloudwatch_log_group.aurora_extra_acu_check",
    "aws_lambda_function.aurora_extra_acu_check",
    "aws_cloudwatch_event_rule.aurora_extra_acu_check",
    "aws_cloudwatch_event_target.aurora_extra_acu_check",
    "aws_lambda_permission.aurora_extra_acu_check",
    "aws_cloudwatch_metric_alarm.aurora_extra_acu_check_errors",
}
IGNORED = {"tags", "tags_all"}
ENVIRONMENT = {"AURORA_CLUSTER_ID": "sea-n-shore-staging-aurora", "BASE_ACU": "2", "ALLOWANCE_ACU_HOURS": "39", "RUPEES_PER_ACU_HOUR": "17.8"}


def changed_keys(before, after, unknown):
    keys = {k for k in set(before) | set(after) if before.get(k) != after.get(k) and k not in IGNORED}
    return sorted(keys | {k for k, v in (unknown or {}).items() if v is True and k in before and k not in IGNORED})


def scaling(values):
    s = (values.get("serverlessv2_scaling_configuration") or [{}])[0]
    return {"min_capacity": s.get("min_capacity"), "max_capacity": s.get("max_capacity")}


def check_create(address, after, errors):
    if address == "aws_iam_role.aurora_extra_acu_check":
        trust = json.loads(after.get("assume_role_policy") or "{}")
        principals = [s.get("Principal") for s in trust.get("Statement", [])]
        if after.get("name") != NAME or principals != [{"Service": "lambda.amazonaws.com"}]:
            errors.append(f"{address} must be the check's own role, assumable by Lambda only")
    elif address == "aws_iam_role_policy.aurora_extra_acu_check":
        policy = after.get("policy")
        statements = json.loads(policy).get("Statement", []) if isinstance(policy, str) else []
        if not statements:
            errors.append(f"{address} must have a known policy")
        actions = sorted(a for s in statements for a in ([s["Action"]] if isinstance(s.get("Action"), str) else s.get("Action", [])))
        if actions != ["cloudwatch:GetMetricData", "logs:CreateLogStream", "logs:PutLogEvents", "sns:Publish"]:
            errors.append(f"{address} may only read metrics, publish to the alerts topic and write its logs: {actions}")
        for s in statements:
            acts = [s["Action"]] if isinstance(s.get("Action"), str) else s.get("Action", [])
            if s.get("Effect") != "Allow":
                errors.append(f"{address} has an unexpected statement")
            if "sns:Publish" in acts and not str(s.get("Resource", "")).endswith(":sea-n-shore-staging-alerts"):
                errors.append(f"{address} may publish to the alerts topic only")
            if any(a.startswith("logs:") for a in acts) and not str(s.get("Resource", "")).endswith(f"/aws/lambda/{NAME}:*"):
                errors.append(f"{address} may write its own log group only")
    elif address == "aws_cloudwatch_log_group.aurora_extra_acu_check":
        if after.get("name") != f"/aws/lambda/{NAME}" or after.get("retention_in_days") != 14:
            errors.append(f"{address} must be the check's log group, kept 14 days")
    elif address == "aws_lambda_function.aurora_extra_acu_check":
        env = ((after.get("environment") or [{}])[0] or {}).get("variables") or {}
        expected = {"function_name": NAME, "runtime": "nodejs22.x", "handler": "aurora-extra-acu-check.handler",
                    "reserved_concurrent_executions": 1, "timeout": 60, "memory_size": 128}
        for key, value in expected.items():
            if after.get(key) != value:
                errors.append(f"{address} must have {key}={value}")
        for key, value in ENVIRONMENT.items():
            if env.get(key) != value:
                errors.append(f"{address} must have {key}={value}")
        if set(env) != set(ENVIRONMENT) | {"ALERT_TOPIC_ARN"}:
            errors.append(f"{address} has unexpected environment variables: {sorted(env)}")
    elif address == "aws_cloudwatch_event_rule.aurora_extra_acu_check":
        if after.get("name") != NAME or after.get("schedule_expression") != "cron(15 * * * ? *)" or after.get("event_pattern"):
            errors.append(f"{address} must be the hourly schedule only")
    elif address == "aws_cloudwatch_event_target.aurora_extra_acu_check":
        if after.get("rule") != NAME or after.get("input") or after.get("input_transformer"):
            errors.append(f"{address} must invoke the check with no input")
    elif address == "aws_lambda_permission.aurora_extra_acu_check":
        if after.get("principal") != "events.amazonaws.com" or after.get("function_name") != NAME or after.get("action") != "lambda:InvokeFunction":
            errors.append(f"{address} may only let the schedule invoke the check")
    elif address == "aws_cloudwatch_metric_alarm.aurora_extra_acu_check_errors":
        expected = {"alarm_name": f"{NAME}-errors", "namespace": "AWS/Lambda", "metric_name": "Errors", "statistic": "Sum",
                    "threshold": 0, "comparison_operator": "GreaterThanThreshold", "dimensions": {"FunctionName": NAME}}
        for key, value in expected.items():
            if after.get(key) != value:
                errors.append(f"{address} must have {key}={value}")
        if len(after.get("alarm_actions") or []) != 1:
            errors.append(f"{address} must email the alerts topic")


def check(address, actions, before, after, unknown, errors):
    if address == CLUSTER:
        if actions != ["update"]:
            errors.append(f"{CLUSTER} may only be updated in place")
            return
        if changed_keys(before, after, unknown) != ["serverlessv2_scaling_configuration"]:
            errors.append(f"{CLUSTER} may only change its capacity range: {changed_keys(before, after, unknown)}")
        if scaling(after) != {"min_capacity": 0.5, "max_capacity": 4}:
            errors.append(f"{CLUSTER} must end at 0.5 to 4 ACU: {scaling(after)}")
        if scaling(before).get("min_capacity") != 0.5:
            errors.append(f"{CLUSTER} floor must already be 0.5 ACU")
        # The stored auto-pause timer (Optional and Computed) stays as it is; Aurora ignores it above a 0 ACU floor.
        timer = lambda v: ((v.get("serverlessv2_scaling_configuration") or [{}])[0] or {}).get("seconds_until_auto_pause")
        timer_unknown = ((unknown.get("serverlessv2_scaling_configuration") or [{}])[0] or {}).get("seconds_until_auto_pause") is True
        if timer(before) != timer(after) and not timer_unknown:
            errors.append(f"{CLUSTER} must keep its auto-pause setting")
        if after.get("deletion_protection") is not True:
            errors.append(f"{CLUSTER} must keep deletion protection on")
    elif address == AT_MAX:
        if actions != ["update"]:
            errors.append(f"{AT_MAX} may only be updated in place")
            return
        if changed_keys(before, after, unknown) != ["threshold"] or after.get("threshold") != 4:
            errors.append(f"{AT_MAX} may only move its threshold to 4: {changed_keys(before, after, unknown)}")
    elif address in CREATES:
        if actions != ["create"]:
            errors.append(f"{address} may only be created")
            return
        check_create(address, after, errors)
    else:
        errors.append(f"Unexpected change: {address} {actions}")


def classify(plan):
    errors, changes, seen = [], [], set()
    for change in plan.get("resource_changes", []):
        if change.get("mode") == "data":
            continue
        actions = change["change"]["actions"]
        if actions == ["no-op"]:
            continue
        address = change["address"]
        if address in seen:
            errors.append(f"Duplicate change: {address}")
        seen.add(address)
        check(address, actions, change["change"].get("before") or {}, change["change"].get("after") or {},
              change["change"].get("after_unknown") or {}, errors)
        changes.append((address, actions))
    created = {a for a, actions in changes if actions == ["create"]}
    if created and created != CREATES:
        errors.append(f"The check must be created whole: missing {sorted(CREATES - created)}")
    return changes, errors


def main(argv):
    with open(argv[1]) as handle:
        plan = json.load(handle)
    changes, errors = classify(plan)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"AURORA_CAPACITY_PLAN_CHANGES={len(changes)}")
    for address, actions in changes:
        print(f"AURORA_CAPACITY_CHANGE={address}|{','.join(actions)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
