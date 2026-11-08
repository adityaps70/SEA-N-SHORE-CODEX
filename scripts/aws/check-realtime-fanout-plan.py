#!/usr/bin/env python3
"""Classifies a targeted Terraform plan for the realtime fan-out (Round ARCH broadcast fix).

Accepts only:
  - no change at all (REALTIME_FANOUT_PLAN=NO_CHANGES), or
  - the Lambda updated in place with new code only, and/or the role policy updated in place whose only difference is
    the removal of one named statement (REALTIME_FANOUT_PLAN=CODE_AND_POLICY_UPDATE).
The archive data source may be read. Anything else exits non-zero with the reason.

Usage: check-realtime-fanout-plan.py PLAN_JSON LAMBDA_ADDRESS POLICY_ADDRESS ARCHIVE_ADDRESS REMOVED_SID
"""
import json
import sys

# What AWS derives from new code; any other Lambda attribute changing refuses.
LAMBDA_CODE_ATTRIBUTES = {'source_code_hash', 'code_sha256', 'last_modified', 'qualified_arn', 'qualified_invoke_arn', 'version'}


def refuse(message):
    raise SystemExit(f'Refusing: {message}')


def statements(policy_text):
    document = json.loads(policy_text)
    items = document.get('Statement', [])
    return [items] if isinstance(items, dict) else items


def check_lambda(change):
    if change['actions'] != ['update']:
        refuse(f"the Lambda {change['actions']} is not an in-place update")
    before, after = change.get('before') or {}, change.get('after') or {}
    unknown = {k for k, v in (change.get('after_unknown') or {}).items() if v}
    changed = {k for k in set(before) | set(after) if before.get(k) != after.get(k)} | unknown
    if 'source_code_hash' not in changed:
        refuse('the Lambda update does not change its code')
    extra = sorted(changed - LAMBDA_CODE_ATTRIBUTES)
    if extra:
        refuse(f'the Lambda update changes more than its code: {extra}')


def check_policy(change, removed_sid):
    if change['actions'] != ['update']:
        refuse(f"the role policy {change['actions']} is not an in-place update")
    before, after = change.get('before') or {}, change.get('after') or {}
    if any(v for v in (change.get('after_unknown') or {}).values()):
        refuse('the role policy update has unknown values')
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    if changed != ['policy']:
        refuse(f'attributes other than the policy document change: {changed}')
    old, new = statements(before['policy']), statements(after['policy'])
    removed = [s for s in old if s not in new]
    added = [s for s in new if s not in old]
    if added:
        refuse(f"the policy adds or changes statements: {[s.get('Sid') for s in added]}")
    if [s.get('Sid') for s in removed] != [removed_sid]:
        refuse(f"the policy removes {[s.get('Sid') for s in removed]}, expected exactly ['{removed_sid}']")
    if [s for s in old if s.get('Sid') != removed_sid] != new:
        refuse('the remaining statements differ or are reordered')


def main(argv):
    plan_path, lambda_address, policy_address, archive_address, removed_sid = argv[1:]
    with open(plan_path) as f:
        plan = json.load(f)
    changes = []
    for resource in plan.get('resource_changes', []):
        actions = resource.get('change', {}).get('actions')
        if actions == ['no-op']:
            continue
        if resource['address'] == archive_address and actions == ['read']:
            continue
        changes.append(resource)
    if not changes:
        print('REALTIME_FANOUT_PLAN=NO_CHANGES')
        return 0
    by_address = {}
    for resource in changes:
        if resource['address'] not in (lambda_address, policy_address) or resource['address'] in by_address:
            refuse('the plan changes ' + ', '.join(f"{c['address']} {c['change']['actions']}" for c in changes))
        by_address[resource['address']] = resource['change']
    if lambda_address in by_address:
        check_lambda(by_address[lambda_address])
    if policy_address in by_address:
        check_policy(by_address[policy_address], removed_sid)
    print('REALTIME_FANOUT_PLAN=CODE_AND_POLICY_UPDATE')
    print('REALTIME_FANOUT_CODE_CHANGES=' + ('true' if lambda_address in by_address else 'false'))
    print('REALTIME_FANOUT_POLICY_REMOVES=' + (removed_sid if policy_address in by_address else 'none'))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
