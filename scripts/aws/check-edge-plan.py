#!/usr/bin/env python3
"""Allow only bounded staging CloudFront, canonical-host redirect function, profile-upload WAF and signed-media changes."""
import copy
import json
import os
import re
import sys
from pathlib import Path

CACHE_POLICY_ID = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad'
ORIGIN_POLICY_ID = 'b689b0a8-53d0-40ab-baf2-68738e2966ac'
# Round 14 (3.1): static assets and optimized images may be cached at the edge; HTML never is.
CACHING_OPTIMIZED_POLICY_ID = '658327ea-f89d-4fab-a63d-7e88639e58f6'
NEXT_IMAGE_POLICY_ADDRESS = 'aws_cloudfront_cache_policy.next_image'
# Round P3 (B4): pages may instead use this policy, which stores only what the origin marks public
# (default TTL 0), at most 5 minutes, keyed on the two session cookies, the RSC/router headers and
# the query string. The default behavior must use it or CachingDisabled; nothing else.
PUBLIC_PAGES_POLICY_ADDRESS = 'aws_cloudfront_cache_policy.public_pages'
PUBLIC_PAGES_SESSION_COOKIES = ['sns_cognito_access', 'sns_cognito_refresh']
# Domain move: x-sns-viewer-host (the real Host, set by the viewer function) keeps each domain's cached pages apart.
PUBLIC_PAGES_KEY_HEADERS = ['next-router-prefetch', 'next-router-segment-prefetch', 'next-router-state-tree', 'rsc', 'x-sns-viewer-host']
PUBLIC_PAGES_MAX_TTL = 300
# Round P3 (B7): signed media. A second origin (the private media bucket through origin access
# control) and a first ordered behavior for /m/* that trusts the media key group, with the
# path-only one-year cache policy below and no viewer function. Plans without them stay valid.
MEDIA_ORIGIN_ID = 'sea-n-shore-staging-media'
MEDIA_ORIGIN_DOMAIN = 'sea-n-shore-staging-310356785722-media.s3.ap-south-1.amazonaws.com'
MEDIA_PATH = '/m/*'
MEDIA_POLICY_ADDRESS = 'aws_cloudfront_cache_policy.media_cdn'
MEDIA_KEY_GROUP_ADDRESS = 'aws_cloudfront_key_group.media_cdn'
MEDIA_OAC_ADDRESS = 'aws_cloudfront_origin_access_control.media'
MEDIA_RATE_SCOPE_DOWN = {'not_statement': [{'statement': [{'byte_match_statement': [{
    'field_to_match': [{'uri_path': [{}]}],
    'positional_constraint': 'STARTS_WITH',
    'search_string': '/m/',
    'text_transformation': [{'priority': 0, 'type': 'NONE'}],
}]}]}]}
# ARCH decision 6 (ship IPs): signed-in traffic is limited per session cookie, not per address.
SESSION_COOKIE = 'sns_cognito_refresh'
SESSION_RATE_RULE = 'PerSessionRateLimit'
IP_CEILING_RULE = 'PerIpCeiling'
_NO_TRANSFORM = [{'priority': 0, 'type': 'NONE'}]
SIGNED_OUT_RATE_SCOPE_DOWN = {'and_statement': [{'statement': [
    MEDIA_RATE_SCOPE_DOWN,
    {'not_statement': [{'statement': [{'size_constraint_statement': [{
        'comparison_operator': 'GT',
        'size': 0,
        'field_to_match': [{'cookies': [{
            'match_pattern': [{'included_cookies': [SESSION_COOKIE]}],
            'match_scope': 'VALUE',
            'oversize_handling': 'MATCH',
        }]}],
        'text_transformation': _NO_TRANSFORM,
    }]}]}]},
]}]}


def _ship_ip_rule(name, priority, metric, rate):
    rate = dict(rate, evaluation_window_sec=300, scope_down_statement=[MEDIA_RATE_SCOPE_DOWN])
    return {
        'name': name,
        'priority': priority,
        'action': [{'block': [{}]}],
        'statement': [{'rate_based_statement': [rate]}],
        'visibility_config': [{
            'cloudwatch_metrics_enabled': True,
            'metric_name': 'sea-n-shore-staging-' + metric,
            'sampled_requests_enabled': True,
        }],
    }


EXPECTED_SHIP_IP_RULES = {
    SESSION_RATE_RULE: _ship_ip_rule(SESSION_RATE_RULE, 21, 'session-rate-limit', {
        'aggregate_key_type': 'CUSTOM_KEYS',
        'limit': 1000,
        'custom_key': [{'cookie': [{'name': SESSION_COOKIE, 'text_transformation': _NO_TRANSFORM}]}],
    }),
    IP_CEILING_RULE: _ship_ip_rule(IP_CEILING_RULE, 22, 'ip-ceiling', {
        'aggregate_key_type': 'IP',
        'limit': 20000,
    }),
}
EXPECTED_ORDERED_BEHAVIORS = [
    ('/_next/static/*', 'optimized'),
    ('/_next/image*', 'next_image'),
    ('/brand/*', 'optimized'),
    ('/landing/*', 'optimized'),
    ('/favicon.ico', 'optimized'),
]
FORWARDED_HOST = 'd3prih0q6jofyr.cloudfront.net'
# Round 14 (1.4): CloudFront reaches the ALB only over HTTPS on the origin hostname, sending the
# shared X-Origin-Verify secret (the ALB answers 403 without it). The secret is passed in by file
# and never appears in an error message.
ORIGIN_HOST = 'origin-staging.seaandshore.in'
ORIGIN_VERIFY_HEADER = 'X-Origin-Verify'
ORIGIN_VERIFY_PATTERN = re.compile(r'[A-Za-z0-9]{48}')


def _sorted_headers(headers):
    return sorted(headers or [], key=lambda header: str(header.get('name', '')))


def expected_custom_headers(origin_verify):
    return _sorted_headers([{'name': 'X-Forwarded-Host', 'value': FORWARDED_HOST}, {'name': ORIGIN_VERIFY_HEADER, 'value': origin_verify}])

CANONICAL_HOST = 'seanshore.in'
# Domain move (owner-approved 18 Nov): the alias domains ride on the same distribution, apex and www.
ALIAS_HOSTS = ['seanshore.net']
EXPECTED_ALIASES = sorted([CANONICAL_HOST, 'www.' + CANONICAL_HOST] + [h for host in ALIAS_HOSTS for h in (host, 'www.' + host)])
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

    has_media_scope = False
    has_signed_out_scope = False
    for rule in normalized.get('rule', []):
        if rule.get('name') != 'PerIpRateLimit':
            continue
        for statement in rule.get('statement', []) or []:
            for rate in statement.get('rate_based_statement', []) or []:
                scope = rate.get('scope_down_statement')
                if scope in (None, []):
                    continue
                if not (isinstance(scope, list) and len(scope) == 1):
                    return None
                if _compact(scope[0]) == MEDIA_RATE_SCOPE_DOWN:
                    has_media_scope = True
                elif _compact(scope[0]) == SIGNED_OUT_RATE_SCOPE_DOWN:
                    # The signed-out scope keeps the media exception and adds the session-cookie one.
                    has_media_scope = True
                    has_signed_out_scope = True
                else:
                    return None
                rate.pop('scope_down_statement')

    # ARCH decision 6: the two ship-IP rules are all or nothing, each exactly as approved, and only
    # together with the signed-out scope on PerIpRateLimit.
    ship_rules = [rule for rule in normalized.get('rule', []) if rule.get('name') in EXPECTED_SHIP_IP_RULES]
    ship_names = [rule.get('name') for rule in ship_rules]
    if len(ship_names) != len(set(ship_names)):
        return None
    for rule in ship_rules:
        if _compact(rule) != EXPECTED_SHIP_IP_RULES[rule['name']]:
            return None
    has_ship_ip = bool(ship_rules)
    if has_ship_ip != has_signed_out_scope or (has_ship_ip and set(ship_names) != set(EXPECTED_SHIP_IP_RULES)):
        return None
    normalized['rule'] = [rule for rule in normalized.get('rule', []) if rule.get('name') not in EXPECTED_SHIP_IP_RULES]

    xss_rules = [rule for rule in normalized.get('rule', []) if rule.get('name') == XSS_BLOCK_RULE]
    if len(xss_rules) > 1:
        return None
    has_xss_rule = len(xss_rules) == 1
    if has_xss_rule and not _is_body_xss_exception_rule(xss_rules[0]):
        return None
    if has_xss_rule:
        normalized['rule'] = [rule for rule in normalized.get('rule', []) if rule.get('name') != XSS_BLOCK_RULE]

    return _compact(normalized), names, has_xss_rule, has_media_scope, has_ship_ip


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

    before_base, before_overrides, before_xss_rule, before_media_scope, before_ship_ip = normalized_before
    after_base, after_overrides, after_xss_rule, after_media_scope, after_ship_ip = normalized_after
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
    # Round P3 (B7): with the profile-media rules unchanged, the rate limit stops counting signed
    # media (/m/*); nothing else may change with it.
    media_scope_transition = (
        before_overrides == after_overrides == {SIZE_OVERRIDE, XSS_OVERRIDE}
        and before_xss_rule and after_xss_rule
        and not before_media_scope
        and after_media_scope
    )
    # ARCH decision 6 (ship IPs): with the profile-media rules and the media exception unchanged,
    # PerIpRateLimit stops counting signed-in requests and the exact per-session limit and per-IP
    # ceiling are added; nothing else may change with them.
    ship_ip_transition = (
        before_overrides == after_overrides == {SIZE_OVERRIDE, XSS_OVERRIDE}
        and before_xss_rule and after_xss_rule
        and before_media_scope and after_media_scope
        and not before_ship_ip
        and after_ship_ip
    )
    if (size_transition or xss_transition) and before_media_scope != after_media_scope:
        return False
    if (size_transition or xss_transition or media_scope_transition) and before_ship_ip != after_ship_ip:
        return False
    return size_transition or xss_transition or media_scope_transition or ship_ip_transition


def rendered_function_code(redirect_edge_host, template_path=None):
    """Render the repository template exactly as edge.tf's templatefile() does."""
    template = Path(template_path or FUNCTION_TEMPLATE).read_text()
    return (
        template
        .replace('${canonical_host}', CANONICAL_HOST)
        .replace('${alias_hosts}', json.dumps(ALIAS_HOSTS, separators=(',', ':')))
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


def _only_grpc_enabled_unknown(value):
    """Accept a provider-computed gRPC block: wholly unknown, or only its enabled flag unknown."""
    if value is True:
        return True
    if not isinstance(value, list) or len(value) > 1:
        return False
    return all(isinstance(item, dict) and set(item) <= {'enabled'} for item in value)


def _grpc_enabled(behavior):
    return any(isinstance(item, dict) and item.get('enabled') is True for item in (behavior.get('grpc_config') or []))


def validate(plan, origin, certificate_arn='', template_path=None, origin_verify=None):
    errors = []
    if not isinstance(origin_verify, str) or not ORIGIN_VERIFY_PATTERN.fullmatch(origin_verify):
        errors.append('Origin verify secret (48 letters/digits) required')
        origin_verify = None
    if origin != ORIGIN_HOST:
        errors.append('Origin must be the dedicated HTTPS origin hostname')
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
        elif address == NEXT_IMAGE_POLICY_ADDRESS:
            if actions not in [['create'], ['update'], ['no-op']]: errors.append('Image cache policy must be create/update/no-op')
        elif address == PUBLIC_PAGES_POLICY_ADDRESS:
            if actions not in [['create'], ['update'], ['no-op']]: errors.append('Page cache policy must be create/update/no-op')
        elif address == MEDIA_POLICY_ADDRESS:
            if actions not in [['create'], ['update'], ['no-op']]: errors.append('Media cache policy must be create/update/no-op')
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
    image_policy_change = changes.get(NEXT_IMAGE_POLICY_ADDRESS, {}).get('change', {})
    image_policy_created = image_policy_change.get('actions') == ['create']
    if image_policy_change.get('actions') in [['create'], ['update']]:
        _validate_next_image_policy(image_policy_change.get('after') or {}, errors)
    pages_policy_change = changes.get(PUBLIC_PAGES_POLICY_ADDRESS, {}).get('change', {})
    pages_policy_created = pages_policy_change.get('actions') == ['create']
    pages_policy_id = (pages_policy_change.get('after') or {}).get('id')
    if pages_policy_change:
        _validate_public_pages_policy(pages_policy_change.get('after') or {}, errors)
    media_policy_change = changes.get(MEDIA_POLICY_ADDRESS, {}).get('change', {})
    if media_policy_change.get('actions') in [['create'], ['update']]:
        _validate_media_policy(media_policy_change.get('after') or {}, errors)
    media = {
        'policy_created': media_policy_change.get('actions') == ['create'],
        'policy_id': (media_policy_change.get('after') or {}).get('id'),
        'key_group_id': ((changes.get(MEDIA_KEY_GROUP_ADDRESS, {}).get('change', {}) or {}).get('after') or {}).get('id'),
        'oac_id': ((changes.get(MEDIA_OAC_ADDRESS, {}).get('change', {}) or {}).get('after') or {}).get('id'),
    }
    for field in ['aliases','enabled','web_acl_id','viewer_certificate','custom_error_response']:
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
                    if block == 'default_cache_behavior' and f == 'cache_policy_id' and pages_policy_created:
                        continue
                    errors.append('Unknown safety field in ' + block)
    if cf.get('web_acl_id') != WAF_ARN or cf.get('enabled') is not True: errors.append('CloudFront ACL/enabled mismatch')
    if sorted(cf.get('aliases') or []) != EXPECTED_ALIASES: errors.append('CloudFront aliases must be exactly seanshore.in, seanshore.net and their www names')
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
        errors.append('seanshore.in + seanshore.net ACM certificate with SNI and TLSv1.2_2021 required')
    all_origins = cf.get('origin', []) or []
    media_origins = [o for o in all_origins if o.get('origin_id') == MEDIA_ORIGIN_ID]
    origins = [o for o in all_origins if o.get('origin_id') != MEDIA_ORIGIN_ID]
    if len(media_origins) > 1:
        errors.append('At most one media origin')
    for media_origin in media_origins:
        _validate_media_origin(media_origin, media, errors)
    if len(origins) != 1 or origins[0].get('domain_name') != origin:
        errors.append('Unexpected origin')
    if len(origins) == 1:
        o = origins[0]
        if origin_verify is None or _sorted_headers(o.get('custom_header')) != expected_custom_headers(origin_verify):
            errors.append('Exact X-Origin-Verify and trusted X-Forwarded-Host origin headers required')
        if o.get('origin_path') not in [None,''] or o.get('origin_id') != 'sea-n-shore-staging-alb': errors.append('Origin path/id mismatch')
        custom = o.get('custom_origin_config', [])
        if len(custom) != 1 or any(custom[0].get(k) != v for k,v in {'http_port':80,'https_port':443,'origin_protocol_policy':'https-only','origin_ssl_protocols':['TLSv1.2']}.items()): errors.append('Origin protocol/ports mismatch (https-only required)')
    behavior = cf.get('default_cache_behavior', [])
    if len(behavior) != 1:
        errors.append('Default behavior missing')
    else:
        b = behavior[0]
        if b.get('target_origin_id') != 'sea-n-shore-staging-alb': errors.append('Behavior target mismatch')
        page_policy = b.get('cache_policy_id')
        page_policy_allowed = (
            page_policy == CACHE_POLICY_ID
            or (bool(pages_policy_id) and page_policy == pages_policy_id)
            or (pages_policy_created and page_policy in [None, ''])
        )
        if b.get('viewer_protocol_policy') != 'redirect-to-https' or not page_policy_allowed or b.get('origin_request_policy_id') != ORIGIN_POLICY_ID: errors.append('HTTPS/cache policy mismatch')
        if sorted(b.get('allowed_methods',[])) != ['DELETE','GET','HEAD','OPTIONS','PATCH','POST','PUT']: errors.append('Methods mismatch')
        if b.get('lambda_function_association'): errors.append('Unexpected Lambda@Edge association')
        associations = b.get('function_association') or []
        if len(associations) != 1 or associations[0].get('event_type') != 'viewer-request':
            errors.append('Exactly one viewer-request canonical-host redirect association required')
        else:
            arn = associations[0].get('function_arn')
            if arn != FUNCTION_ARN and not (arn in [None, ''] and function_created):
                errors.append('Redirect association must reference the repository CloudFront function')
    if cf.get('custom_error_response'): errors.append('Unexpected cache/error override')
    _validate_ordered_behaviors(cf, unknown, image_policy_change, image_policy_created, function_created, errors, media, bool(media_origins))
    return errors


def _validate_media_policy(after, errors):
    params = (after.get('parameters_in_cache_key_and_forwarded_to_origin') or [{}])[0]
    cookies = (params.get('cookies_config') or [{}])[0]
    headers = (params.get('headers_config') or [{}])[0]
    queries = (params.get('query_strings_config') or [{}])[0]
    if (
        after.get('min_ttl') != 86400 or after.get('default_ttl') != 31536000 or after.get('max_ttl') != 31536000
        or cookies.get('cookie_behavior') != 'none'
        or headers.get('header_behavior') != 'none'
        or queries.get('query_string_behavior') != 'none'
    ):
        errors.append('Media cache policy must key on the path only (no cookies, headers or query) for one year')


def _validate_media_origin(o, media, errors):
    if (
        o.get('domain_name') != MEDIA_ORIGIN_DOMAIN
        or o.get('origin_path') not in [None, '']
        or o.get('custom_header')
        or o.get('custom_origin_config')
        or any((config or {}).get('origin_access_identity') not in [None, ''] for config in (o.get('s3_origin_config') or []))
    ):
        errors.append('Media origin must be the private media bucket with no path, headers or custom config')
    if not o.get('origin_access_control_id') or (media.get('oac_id') and o.get('origin_access_control_id') != media['oac_id']):
        errors.append('Media origin must read through the media origin access control')


def _validate_media_behavior(behavior, unknown, media, errors):
    for f, value in (unknown or {}).items():
        if not has_unknown(value):
            continue
        if f == 'cache_policy_id' and media.get('policy_created'):
            continue
        if f in ('default_ttl', 'max_ttl'):
            continue
        if f == 'grpc_config' and _only_grpc_enabled_unknown(value) and not _grpc_enabled(behavior):
            continue
        errors.append('Unknown safety field in ordered behavior ' + MEDIA_PATH + ': ' + f + '=' + json.dumps(value))
    policy = behavior.get('cache_policy_id')
    if not ((media.get('policy_id') and policy == media['policy_id']) or (media.get('policy_created') and policy in [None, ''])):
        errors.append('Cache policy mismatch for ' + MEDIA_PATH)
    key_groups = behavior.get('trusted_key_groups') or []
    if len(key_groups) != 1 or not key_groups[0] or (media.get('key_group_id') and key_groups[0] != media['key_group_id']):
        errors.append('Media behavior must trust exactly the media key group')
    if (
        behavior.get('target_origin_id') != MEDIA_ORIGIN_ID
        or behavior.get('viewer_protocol_policy') != 'redirect-to-https'
        or sorted(behavior.get('allowed_methods') or []) != ['GET', 'HEAD']
        or sorted(behavior.get('cached_methods') or []) != ['GET', 'HEAD']
        or behavior.get('origin_request_policy_id') not in [None, '']
        or behavior.get('function_association')
        or behavior.get('lambda_function_association')
        or behavior.get('trusted_signers')
    ):
        errors.append('Media behavior must be signed GET/HEAD from the media origin over HTTPS, with no functions')


def _validate_next_image_policy(after, errors):
    params = (after.get('parameters_in_cache_key_and_forwarded_to_origin') or [{}])[0]
    cookies = (params.get('cookies_config') or [{}])[0]
    headers = (params.get('headers_config') or [{}])[0]
    queries = (params.get('query_strings_config') or [{}])[0]
    header_items = ((headers.get('headers') or [{}])[0] or {}).get('items') or []
    query_items = ((queries.get('query_strings') or [{}])[0] or {}).get('items') or []
    if (
        cookies.get('cookie_behavior') != 'none'
        or headers.get('header_behavior') != 'whitelist' or sorted(header_items) != ['Accept']
        or queries.get('query_string_behavior') != 'whitelist' or sorted(query_items) != ['q', 'url', 'w']
        or after.get('max_ttl') != 31536000 or after.get('min_ttl') != 0
    ):
        errors.append('Image cache policy must key only on url, w, q and Accept, never cookies')


def _validate_public_pages_policy(after, errors):
    params = (after.get('parameters_in_cache_key_and_forwarded_to_origin') or [{}])[0]
    cookies = (params.get('cookies_config') or [{}])[0]
    headers = (params.get('headers_config') or [{}])[0]
    queries = (params.get('query_strings_config') or [{}])[0]
    cookie_items = ((cookies.get('cookies') or [{}])[0] or {}).get('items') or []
    header_items = ((headers.get('headers') or [{}])[0] or {}).get('items') or []
    if (
        after.get('min_ttl') != 0 or after.get('default_ttl') != 0 or after.get('max_ttl') != PUBLIC_PAGES_MAX_TTL
        or cookies.get('cookie_behavior') != 'whitelist' or sorted(cookie_items) != PUBLIC_PAGES_SESSION_COOKIES
        or headers.get('header_behavior') != 'whitelist' or sorted(item.lower() for item in header_items) != PUBLIC_PAGES_KEY_HEADERS
        or queries.get('query_string_behavior') != 'all'
    ):
        errors.append('Page cache policy must store only origin-marked public responses (TTL 0/0/300), keyed on the session cookies, RSC headers and query')


def _validate_ordered_behaviors(cf, unknown, image_policy_change, image_policy_created, function_created, errors, media=None, has_media_origin=False):
    media = media or {}
    behaviors = cf.get('ordered_cache_behavior') or []
    if not behaviors:
        if has_media_origin:
            errors.append('A media origin needs the signed media behavior')
        return
    unknown_behaviors = unknown.get('ordered_cache_behavior') or []
    if unknown_behaviors is True:
        errors.append('Unknown block: ordered_cache_behavior')
        return
    if behaviors[0].get('path_pattern') == MEDIA_PATH:
        if not has_media_origin:
            errors.append('The signed media behavior needs the media origin')
        media_unknown = unknown_behaviors[0] if unknown_behaviors and isinstance(unknown_behaviors[0], dict) else {}
        _validate_media_behavior(behaviors[0], media_unknown, media, errors)
        behaviors = behaviors[1:]
        unknown_behaviors = unknown_behaviors[1:]
    elif has_media_origin:
        errors.append('A media origin needs the signed media behavior first')
    if [b.get('path_pattern') for b in behaviors] != [path for path, _ in EXPECTED_ORDERED_BEHAVIORS]:
        errors.append('Ordered cache behaviors must be exactly the static asset and image paths')
        return
    image_policy_id = (image_policy_change.get('after') or {}).get('id')
    for index, (behavior, (path, policy)) in enumerate(zip(behaviors, EXPECTED_ORDERED_BEHAVIORS)):
        u = unknown_behaviors[index] if index < len(unknown_behaviors) and isinstance(unknown_behaviors[index], dict) else {}
        for f, value in u.items():
            if not has_unknown(value):
                continue
            if f == 'cache_policy_id' and policy == 'next_image' and image_policy_created:
                continue
            if f == 'function_association' and function_created and _only_function_arn_unknown(value):
                continue
            # Computed by the AWS provider for a new behavior: the TTL fields (the cache policy decides
            # the real TTLs) and gRPC's enabled flag (off unless set; the apply verifies it live).
            if f in ('default_ttl', 'max_ttl'):
                continue
            if f == 'grpc_config' and _only_grpc_enabled_unknown(value) and not _grpc_enabled(behavior):
                continue
            # The unknown markers are booleans only, so printing them exposes no values.
            errors.append('Unknown safety field in ordered behavior ' + path + ': ' + f + '=' + json.dumps(value))
        expected_policy = CACHING_OPTIMIZED_POLICY_ID if policy == 'optimized' else image_policy_id
        if behavior.get('cache_policy_id') != expected_policy and not (policy == 'next_image' and image_policy_created and behavior.get('cache_policy_id') in [None, '']):
            errors.append('Cache policy mismatch for ' + path)
        if (
            behavior.get('target_origin_id') != 'sea-n-shore-staging-alb'
            or behavior.get('viewer_protocol_policy') != 'redirect-to-https'
            or sorted(behavior.get('allowed_methods') or []) != ['GET', 'HEAD']
            or sorted(behavior.get('cached_methods') or []) != ['GET', 'HEAD']
            or behavior.get('compress') is not True
            or behavior.get('origin_request_policy_id') not in [None, '']
            or behavior.get('lambda_function_association')
        ):
            errors.append('Ordered behavior must be GET/HEAD, HTTPS, compressed, without origin request policy: ' + path)
        associations = behavior.get('function_association') or []
        arn = associations[0].get('function_arn') if len(associations) == 1 else None
        if len(associations) != 1 or associations[0].get('event_type') != 'viewer-request' or (arn != FUNCTION_ARN and not (arn in [None, ''] and function_created)):
            errors.append('Ordered behavior must keep the canonical-host redirect: ' + path)


if __name__ == '__main__':
    with open(sys.argv[1]) as f: plan = json.load(f)
    verify_file = os.environ.get('EDGE_ORIGIN_VERIFY_FILE', '')
    origin_verify = open(verify_file).read().strip() if verify_file else None
    errors = validate(plan, sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else '', origin_verify=origin_verify)
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        sys.exit(1)
    print('EDGE_PLAN_GUARD_PASSED: only bounded seanshore.in CloudFront changes, the canonical-host redirect function and exact profile-media WAF transitions allowed')
