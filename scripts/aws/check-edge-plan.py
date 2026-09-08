#!/usr/bin/env python3
"""Allow only bounded staging CloudFront and profile-upload WAF changes."""
import copy
import json
import sys

CACHE_POLICY_ID = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad'
ORIGIN_POLICY_ID = 'b689b0a8-53d0-40ab-baf2-68738e2966ac'
FORWARDED_HOST = 'd3prih0q6jofyr.cloudfront.net'
EXPECTED_CUSTOM_HEADERS = [{'name': 'X-Forwarded-Host', 'value': FORWARDED_HOST}]

WAF_ID = '3d249028-c2ca-4c2e-bcc4-1ef31ad2acc0'
WAF_ARN = 'arn:aws:wafv2:us-east-1:310356785722:global/webacl/sea-n-shore-staging-edge/' + WAF_ID


def has_unknown(value):
    if isinstance(value, dict): return any(has_unknown(v) for v in value.values())
    if isinstance(value, list): return any(has_unknown(v) for v in value)
    return value is True


def _managed_common_statement(waf):
    rules = [rule for rule in waf.get('rule', []) if rule.get('name') == 'AWSManagedRulesCommonRuleSet']
    if len(rules) != 1:
        return None
    statements = rules[0].get('statement', [])
    if len(statements) != 1:
        return None
    groups = statements[0].get('managed_rule_group_statement', [])
    if len(groups) != 1:
        return None
    group = groups[0]
    if group.get('name') != 'AWSManagedRulesCommonRuleSet' or group.get('vendor_name') != 'AWS':
        return None
    return group


def _is_size_body_count_override(value):
    if value.get('name') != 'SizeRestrictions_BODY':
        return False
    actions = value.get('action_to_use', [])
    if len(actions) != 1:
        return False
    action = actions[0]
    if action.get('count') != [{}]:
        return False
    for name, setting in action.items():
        if name != 'count' and setting not in (None, [], {}):
            return False
    return True


def _normalize_waf_without_allowed_override(waf, require_override):
    normalized = copy.deepcopy(waf)
    group = _managed_common_statement(normalized)
    if group is None:
        return None
    overrides = group.get('rule_action_override', []) or []
    allowed = [override for override in overrides if _is_size_body_count_override(override)]
    if require_override and len(allowed) != 1:
        return None
    if any(not _is_size_body_count_override(override) for override in overrides):
        return None
    group.pop('rule_action_override', None)
    return normalized


def _validate_waf_update(change):
    before = change.get('before')
    after = change.get('after')
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    if before.get('id') != WAF_ID or after.get('id') != WAF_ID:
        return False
    normalized_before = _normalize_waf_without_allowed_override(before, False)
    normalized_after = _normalize_waf_without_allowed_override(after, True)
    return normalized_before is not None and normalized_after is not None and normalized_before == normalized_after


def validate(plan, origin):
    errors = []
    changes = {r['address']: r for r in plan.get('resource_changes', [])}
    for address, resource in changes.items():
        actions = resource.get('change', {}).get('actions', [])
        if resource.get('mode') == 'data':
            if actions not in [['read'], ['no-op']]: errors.append('Invalid data action: ' + address)
        elif address == 'aws_cloudfront_distribution.app':
            if actions not in [['create'], ['update'], ['no-op']]: errors.append('CloudFront must be create/update/no-op')
        elif address == 'aws_wafv2_web_acl.edge':
            if actions not in [['update'], ['no-op']]: errors.append('WAF must be update/no-op')
        elif actions != ['no-op']:
            errors.append('Forbidden infrastructure change: ' + address)

    waf = changes.get('aws_wafv2_web_acl.edge', {}).get('change', {})
    waf_actions = waf.get('actions')
    if waf_actions == ['no-op']:
        if waf.get('after', {}).get('id') != WAF_ID:
            errors.append('Existing WAF identity mismatch')
    elif waf_actions == ['update']:
        if not _validate_waf_update(waf):
            errors.append('WAF update must only add SizeRestrictions_BODY Count override')
    else:
        errors.append('Existing WAF must be present')

    cf_change = changes.get('aws_cloudfront_distribution.app', {}).get('change', {})
    cf = cf_change.get('after', {})
    unknown = cf_change.get('after_unknown', {})
    for field in ['aliases','enabled','web_acl_id','viewer_certificate','ordered_cache_behavior','custom_error_response']:
        if has_unknown(unknown.get(field)): errors.append('Unknown safety field: ' + field)
    for block, fields in {'origin':['domain_name','origin_path','origin_id','custom_header','custom_origin_config'], 'default_cache_behavior':['target_origin_id','viewer_protocol_policy','cache_policy_id','origin_request_policy_id','allowed_methods','function_association','lambda_function_association']}.items():
        values = unknown.get(block, [])
        if values is True:
            errors.append('Unknown block: ' + block)
        elif isinstance(values, list):
            for value in values:
                if any(has_unknown(value.get(f)) for f in fields): errors.append('Unknown safety field in ' + block)
    if cf.get('web_acl_id') != WAF_ARN or cf.get('enabled') is not True or ('aliases' not in cf or cf['aliases'] not in [None,[]]): errors.append('CloudFront ACL/enabled/aliases mismatch')
    cert = cf.get('viewer_certificate', [])
    if len(cert) != 1 or cert[0].get('cloudfront_default_certificate') is not True or cert[0].get('acm_certificate_arn') not in [None,'']: errors.append('AWS-managed HTTPS certificate required')
    origins = cf.get('origin', [])
    if len(origins) != 1 or origins[0].get('domain_name') != origin:
        errors.append('Unexpected origin')
    if len(origins) == 1:
        o = origins[0]
        if o.get('custom_header') != EXPECTED_CUSTOM_HEADERS: errors.append('Exact trusted X-Forwarded-Host origin header required')
        if o.get('origin_path') not in [None,''] or o.get('origin_id') != 'sea-n-shore-staging-alb': errors.append('Origin path/id mismatch')
        custom = o.get('custom_origin_config', [])
        if len(custom) != 1 or any(custom[0].get(k) != v for k,v in {'http_port':80,'https_port':443,'origin_protocol_policy':'http-only','origin_ssl_protocols':['TLSv1.2']}.items()): errors.append('Origin protocol/ports mismatch')
    behavior = cf.get('default_cache_behavior', [])
    if len(behavior) != 1:
        errors.append('Default behavior missing')
    else:
        b = behavior[0]
        if b.get('target_origin_id') != 'sea-n-shore-staging-alb': errors.append('Behavior target mismatch')
        if b.get('viewer_protocol_policy') != 'redirect-to-https' or b.get('cache_policy_id') != CACHE_POLICY_ID or b.get('origin_request_policy_id') != ORIGIN_POLICY_ID: errors.append('HTTPS/cache policy mismatch')
        if sorted(b.get('allowed_methods',[])) != ['DELETE','GET','HEAD','OPTIONS','PATCH','POST','PUT']: errors.append('Methods mismatch')
        if any(b.get(k) for k in ['lambda_function_association','function_association']): errors.append('Unexpected edge function')
    if cf.get('ordered_cache_behavior') or cf.get('custom_error_response'): errors.append('Unexpected cache/error override')
    return errors


if __name__ == '__main__':
    with open(sys.argv[1]) as f: plan = json.load(f)
    errors = validate(plan, sys.argv[2])
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        sys.exit(1)
    print('EDGE_PLAN_GUARD_PASSED: only bounded staging CloudFront changes and exact SizeRestrictions_BODY Count override allowed')
