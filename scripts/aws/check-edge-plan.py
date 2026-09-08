#!/usr/bin/env python3
"""Allow only a bounded staging CloudFront edge create/update/no-op."""
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

def validate(plan, origin):
    errors = []
    changes = {r['address']: r for r in plan.get('resource_changes', [])}
    for address, resource in changes.items():
        actions = resource.get('change', {}).get('actions', [])
        if resource.get('mode') == 'data':
            if actions not in [['read'], ['no-op']]: errors.append('Invalid data action: ' + address)
        elif address == 'aws_cloudfront_distribution.app':
            if actions not in [['create'], ['update'], ['no-op']]: errors.append('CloudFront must be create/update/no-op')
        elif actions != ['no-op']:
            errors.append('Forbidden infrastructure change: ' + address)
    waf = changes.get('aws_wafv2_web_acl.edge', {}).get('change', {})
    if waf.get('actions') != ['no-op'] or waf.get('after', {}).get('id') != WAF_ID:
        errors.append('Existing WAF must be unchanged')
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
    print('EDGE_PLAN_GUARD_PASSED: existing WAF unchanged; only bounded staging CloudFront create/update/no-op with exact forwarded host allowed')
