#!/usr/bin/env python3
"""Allow only bounded staging CloudFront, canonical-host redirect function and profile-upload WAF changes."""
import copy
import json
import sys
from pathlib import Path

CACHE_POLICY_ID = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad'
ORIGIN_POLICY_ID = 'b689b0a8-53d0-40ab-baf2-68738e2966ac'
FORWARDED_HOST = 'd3prih0q6jofyr.cloudfront.net'
EXPECTED_CUSTOM_HEADERS = [{'name': 'X-Forwarded-Host', 'value': FORWARDED_HOST}]

CANONICAL_HOST = 'seanshore.in'
EXPECTED_ALIASES = [CANONICAL_HOST, 'www.' + CANONICAL_HOST]
CERTIFICATE_ARN_PREFIX = 'arn:aws:acm:us-east-1:310356785722:certificate/'
FUNCTION_ADDRESS = 'aws_cloudfront_function.canonical_host_redirect'
FUNCTION_NAME = 'sea-n-shore-staging-canonical-host-redirect'
FUNCTION_ARN = 'arn:aws:cloudfront::310356785722:function/' + FUNCTION_NAME
FUNCTION_RUNTIME = 'cloudfront-js-2.0'
FUNCTION_TEMPLATE = Path(__file__).resolve().parents[2] / 'infra' / 'aws' / 'app' / 'cloudfront' / 'canonical-host-redirect.js.tftpl'

WAF_ID = '3d249028-c2ca-4c2e-bcc4-1ef31ad2acc0'
WAF_ARN = 'arn:aws:wafv2:us-east-1:310356785722:global/webacl/sea-n-shore-staging-edge/' + WAF_ID
SIZE_OVERRIDE = 'SizeRestrictions_BODY'
XSS_OVERRIDE = 'CrossSiteScripting_BODY'
XSS_LABEL = 'awswaf:managed:aws:core-rule-set:CrossSiteScripting_Body'
XSS_BLOCK_RULE = 'BlockManagedBodyXssExceptProfileMedia'


def has_unknown(value):
    if isinstance(value, dict): return any(has_unknown(v) for v in value.values())
    if isinstance(value, list): return any(has_unknown(v) for v in value)
    return value is True


def _compact(value):
    """Drop provider-expanded empty sibling fields while retaining marker blocks like [{}]."""
    if isinstance(value, dict):
        result = {}
        for key, child in value.items():
            compacted = _compact(child)
            if compacted not in (None, [], {}):
                result[key] = compacted
            elif isinstance(child, list) and child and all(isinstance(item, dict) for item in child):
                # Terraform represents marker blocks such as method {}, block {}, and count {}
                # as one-element lists containing an otherwise empty object.
                result[key] = [{}]
        return result
    if isinstance(value, list):
        return [_compact(item) for item in value]
    return value


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


def _is_count_override(value, expected_name):
    if value.get('name') != expected_name:
        return False
    actions = value.get('action_to_use', [])
    if len(actions) != 1:
        return False
    return _compact(actions[0]) == {'count': [{}]}


def _is_body_xss_exception_rule(rule):
    expected = {
        'name': XSS_BLOCK_RULE,
        'priority': 15,
        'action': [{'block': [{}]}],
        'statement': [{
            'and_statement': [{
                'statement': [
                    {'label_match_statement': [{'scope': 'LABEL', 'key': XSS_LABEL}]},
                    {'not_statement': [{
                        'statement': [{
                            'and_statement': [{
                                'statement': [
                                    {'byte_match_statement': [{
                                        'field_to_match': [{'method': [{}]}],
                                        'positional_constraint': 'EXACTLY',
                                        'search_string': 'POST',
                                        'text_transformation': [{'priority': 0, 'type': 'NONE'}],
                                    }]},
                                    {'byte_match_statement': [{
                                        'field_to_match': [{'uri_path': [{}]}],
                                        'positional_constraint': 'EXACTLY',
                                        'search_string': '/profile',
                                        'text_transformation': [{'priority': 0, 'type': 'NONE'}],
                                    }]},
                                ]
                            }]
                        }]
                    }]},
                ]
            }]
        }],
        'visibility_config': [{
            'cloudwatch_metrics_enabled': True,
            'metric_name': 'sea-n-shore-staging-body-xss-block',
            'sampled_requests_enabled': True,
        }],
    }
    return _compact(rule) == expected


def _normalize_waf(waf):
    normalized = copy.deepcopy(waf)
    group = _managed_common_statement(normalized)
    if group is None:
        return None

    overrides = group.get('rule_action_override', []) or []
    names = set()
    for override in overrides:
        name = override.get('name')
        if name not in (SIZE_OVERRIDE, XSS_OVERRIDE) or not _is_count_override(override, name):
            return None
        if name in names:
            return None
        names.add(name)
    group.pop('rule_action_override', None)

    xss_rules = [rule for rule in normalized.get('rule', []) if rule.get('name') == XSS_BLOCK_RULE]
    if len(xss_rules) > 1:
        return None
    has_xss_rule = len(xss_rules) == 1
    if has_xss_rule and not _is_body_xss_exception_rule(xss_rules[0]):
        return None
    if has_xss_rule:
        normalized['rule'] = [rule for rule in normalized.get('rule', []) if rule.get('name') != XSS_BLOCK_RULE]

    return _compact(normalized), names, has_xss_rule


def _diagnose_override_shape(label, waf):
    print(f'WAF_OVERRIDE_SHAPE_{label}_BEGIN', file=sys.stderr)
    if not isinstance(waf, dict):
        print(f'waf_type={type(waf).__name__}', file=sys.stderr)
        print(f'WAF_OVERRIDE_SHAPE_{label}_END', file=sys.stderr)
        return
    rules = waf.get('rule', [])
    print('rule_names=' + repr([rule.get('name') for rule in rules if isinstance(rule, dict)]), file=sys.stderr)
    group = _managed_common_statement(waf)
    if group is None:
        common = [rule for rule in rules if isinstance(rule, dict) and rule.get('name') == 'AWSManagedRulesCommonRuleSet']
        print('managed_common_rule=' + repr(common[:1]), file=sys.stderr)
    else:
        print('group_name=' + repr(group.get('name')), file=sys.stderr)
        print('vendor_name=' + repr(group.get('vendor_name')), file=sys.stderr)
        print('rule_action_override=' + repr(group.get('rule_action_override', [])), file=sys.stderr)
    print(f'WAF_OVERRIDE_SHAPE_{label}_END', file=sys.stderr)


def _diff_paths(before, after, path='$'):
    """Return compact structural differences for a failed guard; never relax validation."""
    if type(before) is not type(after):
        return [f'{path}: type {type(before).__name__} -> {type(after).__name__}']
    if isinstance(before, dict):
        diffs = []
        for key in sorted(set(before) | set(after)):
            child = f'{path}.{key}'
            if key not in before:
                diffs.append(f'{child}: added={after[key]!r}')
            elif key not in after:
                diffs.append(f'{child}: removed={before[key]!r}')
            else:
                diffs.extend(_diff_paths(before[key], after[key], child))
            if len(diffs) >= 20:
                return diffs[:20]
        return diffs
    if isinstance(before, list):
        if len(before) != len(after):
            return [f'{path}: length {len(before)} -> {len(after)}']
        diffs = []
        for index, (left, right) in enumerate(zip(before, after)):
            diffs.extend(_diff_paths(left, right, f'{path}[{index}]'))
            if len(diffs) >= 20:
                return diffs[:20]
        return diffs
    return [] if before == after else [f'{path}: {before!r} -> {after!r}']


def _validate_waf_update(change):
    before = change.get('before')
    after = change.get('after')
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    if before.get('id') != WAF_ID or after.get('id') != WAF_ID:
        return False

    normalized_before = _normalize_waf(before)
    normalized_after = _normalize_waf(after)
    if normalized_before is None:
        _diagnose_override_shape('BEFORE', before)
    if normalized_after is None:
        _diagnose_override_shape('AFTER', after)
    if normalized_before is None or normalized_after is None:
        return False

    before_base, before_overrides, before_xss_rule = normalized_before
    after_base, after_overrides, after_xss_rule = normalized_after
    if before_base != after_base:
        print('WAF_NORMALIZED_DIFF_BEGIN', file=sys.stderr)
        for difference in _diff_paths(before_base, after_base):
            print(difference, file=sys.stderr)
        print('WAF_NORMALIZED_DIFF_END', file=sys.stderr)
        return False

    # Historical first media exception: no body overrides -> only SizeRestrictions_BODY Count.
    size_transition = (
        before_overrides == set()
        and not before_xss_rule
        and after_overrides == {SIZE_OVERRIDE}
        and not after_xss_rule
    )

    # Current media fix: retain SizeRestrictions_BODY Count, add only the CRS body-XSS
    # Count override, and restore that managed block everywhere except exact POST /profile.
    xss_transition = (
        before_overrides == {SIZE_OVERRIDE}
        and not before_xss_rule
        and after_overrides == {SIZE_OVERRIDE, XSS_OVERRIDE}
        and after_xss_rule
    )
    return size_transition or xss_transition


def rendered_function_code(redirect_edge_host, template_path=None):
    """Render the repository template exactly as edge.tf's templatefile() does."""
    template = Path(template_path or FUNCTION_TEMPLATE).read_text()
    return (
        template
        .replace('${canonical_host}', CANONICAL_HOST)
        .replace('${edge_host}', FORWARDED_HOST)
        .replace('${redirect_edge_host}', 'true' if redirect_edge_host else 'false')
    )


def _validate_function(change, errors, template_path=None):
    after = change.get('after') or {}
    unknown = change.get('after_unknown') or {}
    for field in ['name', 'runtime', 'publish', 'code', 'key_value_store_associations']:
        if has_unknown(unknown.get(field)):
            errors.append('Unknown redirect function field: ' + field)
    if after.get('name') != FUNCTION_NAME: errors.append('Redirect function name mismatch')
    if after.get('runtime') != FUNCTION_RUNTIME: errors.append('Redirect function runtime mismatch')
    if after.get('publish') is not True: errors.append('Redirect function must be published')
    if after.get('key_value_store_associations') not in [None, []]: errors.append('Redirect function must not attach key-value stores')
    try:
        expected = {rendered_function_code(False, template_path), rendered_function_code(True, template_path)}
    except OSError:
        expected = set()
    if after.get('code') not in expected:
        errors.append('Redirect function code must be the repository template rendered for seanshore.in')


def _only_function_arn_unknown(value):
    """Accept an unknown function ARN only for a single association whose other fields are known."""
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        return False
    return set(value[0]) <= {'function_arn'} and value[0].get('function_arn') is True


def validate(plan, origin, certificate_arn='', template_path=None):
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
        elif address == FUNCTION_ADDRESS:
            if actions not in [['create'], ['update'], ['no-op']]: errors.append('Redirect function must be create/update/no-op')
        elif actions != ['no-op']:
            errors.append('Forbidden infrastructure change: ' + address)

    function_change = changes.get(FUNCTION_ADDRESS, {}).get('change', {})
    function_actions = function_change.get('actions')
    if function_actions in [['create'], ['update'], ['no-op']]:
        _validate_function(function_change, errors, template_path)
    else:
        errors.append('Canonical-host redirect function must be present')
    function_created = function_actions == ['create']

    waf = changes.get('aws_wafv2_web_acl.edge', {}).get('change', {})
    waf_actions = waf.get('actions')
    if waf_actions == ['no-op']:
        if waf.get('after', {}).get('id') != WAF_ID:
            errors.append('Existing WAF identity mismatch')
    elif waf_actions == ['update']:
        if not _validate_waf_update(waf):
            errors.append('WAF update must be an exact bounded profile-media body-rule transition')
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
                for f in fields:
                    if not has_unknown(value.get(f)):
                        continue
                    if block == 'default_cache_behavior' and f == 'function_association' and function_created and _only_function_arn_unknown(value.get(f)):
                        continue
                    errors.append('Unknown safety field in ' + block)
    if cf.get('web_acl_id') != WAF_ARN or cf.get('enabled') is not True: errors.append('CloudFront ACL/enabled mismatch')
    if sorted(cf.get('aliases') or []) != EXPECTED_ALIASES: errors.append('CloudFront aliases must be exactly seanshore.in and www.seanshore.in')
    cert = cf.get('viewer_certificate', [])
    if (
        not certificate_arn
        or not certificate_arn.startswith(CERTIFICATE_ARN_PREFIX)
        or len(cert) != 1
        or cert[0].get('acm_certificate_arn') != certificate_arn
        or cert[0].get('ssl_support_method') != 'sni-only'
        or cert[0].get('minimum_protocol_version') != 'TLSv1.2_2021'
        or cert[0].get('cloudfront_default_certificate') not in [None, False]
        or cert[0].get('iam_certificate_id') not in [None, '']
    ):
        errors.append('seanshore.in ACM certificate with SNI and TLSv1.2_2021 required')
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
        if b.get('lambda_function_association'): errors.append('Unexpected Lambda@Edge association')
        associations = b.get('function_association') or []
        if len(associations) != 1 or associations[0].get('event_type') != 'viewer-request':
            errors.append('Exactly one viewer-request canonical-host redirect association required')
        else:
            arn = associations[0].get('function_arn')
            if arn != FUNCTION_ARN and not (arn in [None, ''] and function_created):
                errors.append('Redirect association must reference the repository CloudFront function')
    if cf.get('ordered_cache_behavior') or cf.get('custom_error_response'): errors.append('Unexpected cache/error override')
    return errors


if __name__ == '__main__':
    with open(sys.argv[1]) as f: plan = json.load(f)
    errors = validate(plan, sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else '')
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        sys.exit(1)
    print('EDGE_PLAN_GUARD_PASSED: only bounded seanshore.in CloudFront changes, the canonical-host redirect function and exact profile-media WAF transitions allowed')
