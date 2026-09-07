#!/usr/bin/env python3
"""Allow only creation (or no-op verification) of the staging CloudFront edge."""
import json
import sys

WAF_ID = '3d249028-c2ca-4c2e-bcc4-1ef31ad2acc0'
WAF_ARN = 'arn:aws:wafv2:us-east-1:310356785722:global/webacl/sea-n-shore-staging-edge/' + WAF_ID

def validate(plan, origin):
    errors = []
    changes = {r['address']: r for r in plan.get('resource_changes', [])}
    for address, resource in changes.items():
        actions = resource.get('change', {}).get('actions', [])
        if resource.get('mode') == 'data':
            if actions not in [['read'], ['no-op']]: errors.append('Invalid data action: ' + address)
        elif address == 'aws_cloudfront_distribution.app':
            if actions not in [['create'], ['no-op']]: errors.append('CloudFront must be create/no-op')
        elif actions != ['no-op']:
            errors.append('Forbidden infrastructure change: ' + address)
    waf = changes.get('aws_wafv2_web_acl.edge', {}).get('change', {})
    if waf.get('actions') != ['no-op'] or waf.get('after', {}).get('id') != WAF_ID:
        errors.append('Existing WAF must be unchanged')
    cf = changes.get('aws_cloudfront_distribution.app', {}).get('change', {}).get('after', {})
    resources = {r['address']:r.get('values', {}) for r in plan.get('planned_values', {}).get('root_module', {}).get('resources', [])}
    cache = resources.get('data.aws_cloudfront_cache_policy.caching_disabled', {})
    request = resources.get('data.aws_cloudfront_origin_request_policy.all_viewer_except_host', {})
    if cache.get('name') != 'Managed-CachingDisabled' or not cache.get('id'): errors.append('CachingDisabled policy missing')
    if request.get('name') != 'Managed-AllViewerExceptHostHeader' or not request.get('id'): errors.append('Origin policy missing')
    if cf.get('web_acl_id') != WAF_ARN or cf.get('enabled') is not True or cf.get('aliases') not in [[],set()]: errors.append('CloudFront ACL/enabled/aliases mismatch')
    cert = cf.get('viewer_certificate', [])
    if len(cert) != 1 or cert[0].get('cloudfront_default_certificate') is not True or cert[0].get('acm_certificate_arn') not in [None,'']: errors.append('AWS-managed HTTPS certificate required')
    origins = cf.get('origin', [])
    if len(origins) != 1 or origins[0].get('domain_name') != origin or origins[0].get('custom_header') not in [None,[]]: errors.append('Unexpected origin')
    behavior = cf.get('default_cache_behavior', [])
    if len(behavior) != 1:
        errors.append('Default behavior missing')
    else:
        b = behavior[0]
        if b.get('viewer_protocol_policy') != 'redirect-to-https' or b.get('cache_policy_id') != cache.get('id') or b.get('origin_request_policy_id') != request.get('id'): errors.append('HTTPS/cache policy mismatch')
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
    print('EDGE_PLAN_GUARD_PASSED: existing WAF unchanged; only staging CloudFront create/no-op allowed')
