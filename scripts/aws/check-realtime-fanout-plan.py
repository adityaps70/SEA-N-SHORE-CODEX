#!/usr/bin/env python3
"""Classifies a targeted Terraform plan for the realtime Lambdas (Round ARCH broadcast fix, Phase 5).

Accepts only:
  - no change at all (REALTIME_FANOUT_PLAN=NO_CHANGES), or
  - any of the listed Lambdas updated in place with new code only, and/or the fan-out role policy updated in place
    whose only difference is the removal of one named statement, and/or (Phase 5) the realtime EventBridge rule
    updated in place whose only difference is its detail-type list gaining exactly the expected types
    (REALTIME_FANOUT_PLAN=CODE_AND_POLICY_UPDATE).
The listed archive data sources may be read. Anything else exits non-zero with the reason.

Usage: check-realtime-fanout-plan.py PLAN_JSON LAMBDA_ADDRESSES POLICY_ADDRESS ARCHIVE_ADDRESSES REMOVED_SID \
         [RULE_ADDRESS ADDED_TYPES_JSON]
  (LAMBDA_ADDRESSES and ARCHIVE_ADDRESSES are comma-separated)
"""
import json
import sys

# What AWS derives from new code; any other Lambda attribute changing refuses.
LAMBDA_CODE_ATTRIBUTES = {'source_code_hash', 'code_sha256', 'last_modified', 'qualified_arn', 'qualified_invoke_arn', 'version'}


def refuse(message):
    raise SystemExit(f'Refusing: {message}')


def has_unknown(value):
    """True only when a leaf is true. Terraform describes nested blocks in after_unknown with placeholders such as
    [{}] or [false] even when nothing in them is unknown (first plan run 42457216357), so truthiness is not enough."""
    if value is True:
        return True
    if isinstance(value, dict):
        return any(has_unknown(v) for v in value.values())
    if isinstance(value, list):
        return any(has_unknown(v) for v in value)
    return False


def statements(policy_text):
    document = json.loads(policy_text)
    items = document.get('Statement', [])
    return [items] if isinstance(items, dict) else items


def check_lambda(change):
    if change['actions'] != ['update']:
        refuse(f"the Lambda {change['actions']} is not an in-place update")
    before, after = change.get('before') or {}, change.get('after') or {}
    unknown = {k for k, v in (change.get('after_unknown') or {}).items() if has_unknown(v)}
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
    if any(has_unknown(v) for v in (change.get('after_unknown') or {}).values()):
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


def check_rule(change, expected_added):
    if change['actions'] != ['update']:
        refuse(f"the realtime rule {change['actions']} is not an in-place update")
    before, after = change.get('before') or {}, change.get('after') or {}
    if any(has_unknown(v) for v in (change.get('after_unknown') or {}).values()):
        refuse('the realtime rule update has unknown values')
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    if changed != ['event_pattern']:
        refuse(f'attributes other than the rule pattern change: {changed}')
    old, new = json.loads(before['event_pattern']), json.loads(after['event_pattern'])
    if set(old) != set(new) or any(old[k] != new[k] for k in old if k != 'detail-type'):
        refuse('the rule pattern changes more than its detail-type list')
    old_types, new_types = set(old.get('detail-type', [])), set(new.get('detail-type', []))
    if old_types - new_types:
        refuse(f'the rule update would drop {sorted(old_types - new_types)}')
    if new_types - old_types != set(expected_added):
        refuse(f'the rule update adds {sorted(new_types - old_types)}, expected exactly {sorted(expected_added)}')
    return sorted(new_types - old_types)


def main(argv):
    plan_path, lambda_list, policy_address, archive_list, removed_sid, *rule_args = argv[1:]
    rule_address, expected_added = (rule_args[0], json.loads(rule_args[1])) if len(rule_args) == 2 else (None, [])
    lambda_addresses = [a for a in lambda_list.split(',') if a]
    archive_addresses = {a for a in archive_list.split(',') if a}
    with open(plan_path) as f:
        plan = json.load(f)
    changes = []
    for resource in plan.get('resource_changes', []):
        actions = resource.get('change', {}).get('actions')
        if actions == ['no-op']:
            continue
        if resource['address'] in archive_addresses and actions == ['read']:
            continue
        changes.append(resource)
    if not changes:
        print('REALTIME_FANOUT_PLAN=NO_CHANGES')
        return 0
    by_address = {}
    for resource in changes:
        allowed = (*lambda_addresses, policy_address, *((rule_address,) if rule_address else ()))
        if resource['address'] not in allowed or resource['address'] in by_address:
            refuse('the plan changes ' + ', '.join(f"{c['address']} {c['change']['actions']}" for c in changes))
        by_address[resource['address']] = resource['change']
    for address in lambda_addresses:
        if address in by_address:
            check_lambda(by_address[address])
    if policy_address in by_address:
        check_policy(by_address[policy_address], removed_sid)
    added = check_rule(by_address[rule_address], expected_added) if rule_address in by_address else []
    print('REALTIME_FANOUT_PLAN=CODE_AND_POLICY_UPDATE')
    print('REALTIME_FANOUT_RULE_ADDS=' + (json.dumps(added) if added else 'none'))
    print('REALTIME_FANOUT_CODE_CHANGES=' + (','.join(a for a in lambda_addresses if a in by_address) or 'none'))
    print('REALTIME_FANOUT_POLICY_REMOVES=' + (removed_sid if policy_address in by_address else 'none'))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
