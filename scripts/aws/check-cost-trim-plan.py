#!/usr/bin/env python3
"""Round DB (cost): checks the targeted Terraform plan of scripts/aws/cost-trim-infra.sh.

  check-cost-trim-plan.py PLAN_JSON

Accepts only, each at most once:
  - aws_ecs_cluster.app: an in-place update whose only change is the containerInsights setting, to "disabled";
  - aws_cloudwatch_metric_alarm.web_running_tasks_low: an in-place update that only moves the alarm to the ALB's
    HealthyHostCount (namespace, metric, dimensions, description), keeping its threshold, period and actions;
  - aws_cloudwatch_metric_alarm.web_ephemeral_storage_high: a delete.
No change at all (already applied) is accepted too. Prints COST_TRIM_PLAN_CHANGES=<n> and one line per change.
"""
import json
import sys

CLUSTER = "aws_ecs_cluster.app"
RUNNING = "aws_cloudwatch_metric_alarm.web_running_tasks_low"
EPHEMERAL = "aws_cloudwatch_metric_alarm.web_ephemeral_storage_high"
IGNORED = {"tags", "tags_all"}


def changed_keys(before, after):
    return sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k) and k not in IGNORED)


def check(address, actions, before, after, errors):
    if address == CLUSTER:
        if actions != ["update"]:
            errors.append(f"{CLUSTER} may only be updated in place")
            return
        if changed_keys(before, after) != ["setting"]:
            errors.append(f"{CLUSTER} may only change its setting: {changed_keys(before, after)}")
        if [(s.get("name"), s.get("value")) for s in after.get("setting") or []] != [("containerInsights", "disabled")]:
            errors.append("The cluster setting must be containerInsights=disabled and nothing else")
    elif address == RUNNING:
        if actions != ["update"]:
            errors.append(f"{RUNNING} may only be updated in place")
            return
        allowed = {"namespace", "metric_name", "dimensions", "alarm_description"}
        extra = set(changed_keys(before, after)) - allowed
        if extra:
            errors.append(f"{RUNNING} may only change its metric: {sorted(extra)}")
        dims = after.get("dimensions") or {}
        if (after.get("namespace"), after.get("metric_name")) != ("AWS/ApplicationELB", "HealthyHostCount") or sorted(dims) != ["LoadBalancer", "TargetGroup"]:
            errors.append(f"{RUNNING} must read AWS/ApplicationELB HealthyHostCount for the web target group")
        if not str(dims.get("TargetGroup", "")).startswith("targetgroup/sea-n-shore-staging-web/") or not str(dims.get("LoadBalancer", "")).startswith("app/sea-n-shore-staging-alb/"):
            errors.append(f"{RUNNING} must watch the web target group behind the staging ALB")
        keep = {"statistic": "Minimum", "period": 60, "evaluation_periods": 5, "threshold": 2,
                "comparison_operator": "LessThanThreshold", "treat_missing_data": "breaching"}
        for key, value in keep.items():
            if after.get(key) != value:
                errors.append(f"{RUNNING} must keep {key}={value}")
        if not after.get("alarm_actions") or after.get("alarm_actions") != before.get("alarm_actions"):
            errors.append(f"{RUNNING} must keep its alarm actions")
    elif address == EPHEMERAL:
        if actions != ["delete"]:
            errors.append(f"{EPHEMERAL} may only be deleted")
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
        check(address, actions, change["change"].get("before") or {}, change["change"].get("after") or {}, errors)
        changes.append((address, actions))
    return changes, errors


def main(argv):
    with open(argv[1]) as handle:
        plan = json.load(handle)
    changes, errors = classify(plan)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"COST_TRIM_PLAN_CHANGES={len(changes)}")
    for address, actions in changes:
        print(f"COST_TRIM_CHANGE={address}|{','.join(actions)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
