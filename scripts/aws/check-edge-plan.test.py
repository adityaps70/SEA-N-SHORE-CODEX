import copy
import importlib.util
import re
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('check-edge-plan.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


CERT_ARN = guard.CERTIFICATE_ARN_PREFIX + '0f6a5b3c-1d2e-4f70-8a9b-0c1d2e3f4a5b'
# Round 14 (1.4): a fixture origin secret (48 letters/digits) and the dedicated HTTPS origin.
SECRET = 'TestOriginVerify0123456789abcdefghijklmnopqrstuv'
ORIGIN_HOST = guard.ORIGIN_HOST


def cloudfront_after():
    return {'web_acl_id':guard.WAF_ARN,'enabled':True,'aliases':['www.seanshore.in','seanshore.in','seanshore.net','www.seanshore.net'], 'viewer_certificate':[{'acm_certificate_arn':CERT_ARN,'cloudfront_default_certificate':False,'iam_certificate_id':'','minimum_protocol_version':'TLSv1.2_2021','ssl_support_method':'sni-only'}], 'origin':[{'domain_name':ORIGIN_HOST,'origin_id':'sea-n-shore-staging-alb','origin_path':'','custom_header':guard.expected_custom_headers(SECRET),'custom_origin_config':[{'http_port':80,'https_port':443,'origin_protocol_policy':'https-only','origin_ssl_protocols':['TLSv1.2']}]}], 'default_cache_behavior':[{'target_origin_id':'sea-n-shore-staging-alb','viewer_protocol_policy':'redirect-to-https','cache_policy_id':guard.CACHE_POLICY_ID,'origin_request_policy_id':guard.ORIGIN_POLICY_ID,'allowed_methods':['DELETE','GET','HEAD','OPTIONS','PATCH','POST','PUT'],'function_association':[{'event_type':'viewer-request','function_arn':guard.FUNCTION_ARN}],'lambda_function_association':[]}]}


def function_after(redirect_edge_host=False):
    return {'name':guard.FUNCTION_NAME,'runtime':guard.FUNCTION_RUNTIME,'publish':True,'key_value_store_associations':[],'code':guard.rendered_function_code(redirect_edge_host)}


def function_change(actions=None, redirect_edge_host=False):
    return {'address':guard.FUNCTION_ADDRESS,'mode':'managed','change':{'actions':actions or ['no-op'],'after':function_after(redirect_edge_host)}}


def count_override(name):
    return {'name':name,'action_to_use':[{'count':[{}]}]}


def common_rule(overrides=None):
    statement={'managed_rule_group_statement':[{'name':'AWSManagedRulesCommonRuleSet','vendor_name':'AWS'}]}
    if overrides is not None:
        statement['managed_rule_group_statement'][0]['rule_action_override']=overrides
    return {'name':'AWSManagedRulesCommonRuleSet','priority':10,'statement':[statement]}


def body_xss_rule():
    return {
        'name':'BlockManagedBodyXssExceptProfileMedia',
        'priority':15,
        'action':[{'block':[{}]}],
        'statement':[{
            'and_statement':[{
                'statement':[
                    {'label_match_statement':[{
                        'scope':'LABEL',
                        'key':'awswaf:managed:aws:core-rule-set:CrossSiteScripting_Body',
                    }]},
                    {'not_statement':[{
                        'statement':[{
                            'and_statement':[{
                                'statement':[
                                    {'byte_match_statement':[{
                                        'field_to_match':[{'method':[{}]}],
                                        'positional_constraint':'EXACTLY',
                                        'search_string':'POST',
                                        'text_transformation':[{'priority':0,'type':'NONE'}],
                                    }]},
                                    {'byte_match_statement':[{
                                        'field_to_match':[{'uri_path':[{}]}],
                                        'positional_constraint':'EXACTLY',
                                        'search_string':'/profile',
                                        'text_transformation':[{'priority':0,'type':'NONE'}],
                                    }]},
                                ]
                            }]
                        }]
                    }]},
                ]
            }]
        }],
        'visibility_config':[{
            'cloudwatch_metrics_enabled':True,
            'metric_name':'sea-n-shore-staging-body-xss-block',
            'sampled_requests_enabled':True,
        }],
    }


def rate_rule():
    return {
        'name':'PerIpRateLimit',
        'priority':20,
        'action':[{'block':[{}]}],
        'statement':[{'rate_based_statement':[{
            'aggregate_key_type':'IP',
            'evaluation_window_sec':300,
            'limit':2000,
        }]}],
    }


class EdgePlanTests(unittest.TestCase):
    def test_rejects_unrelated_changes_and_waf_recreation(self):
        for address, actions in [('aws_ecs_service.app', ['update']), ('aws_wafv2_web_acl.edge', ['delete','create']), ('aws_route53_record.production', ['create'])]:
            plan={'resource_changes':[{'address':address,'mode':'managed','change':{'actions':actions}}]}
            self.assertTrue(guard.validate(plan, ORIGIN_HOST, CERT_ARN, origin_verify=SECRET))

    def test_rejects_empty_plan_without_existing_waf(self):
        self.assertTrue(guard.validate({}, ORIGIN_HOST, CERT_ARN, origin_verify=SECRET))

    def test_accepts_only_size_restrictions_body_count_override_as_waf_update(self):
        before={'id':guard.WAF_ID,'rule':[common_rule()]}
        after=copy.deepcopy(before)
        after['rule'][0]['statement'][0]['managed_rule_group_statement'][0]['rule_action_override']=[
            count_override('SizeRestrictions_BODY'),
        ]
        plan={'resource_changes':[
            {'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['update'],'before':before,'after':after}},
            {'address':'aws_cloudfront_distribution.app','mode':'managed','change':{'actions':['no-op'],'after':cloudfront_after()}},
            function_change(),
        ]}
        self.assertEqual(guard.validate(plan,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET),[])

        provider_expanded=copy.deepcopy(plan)
        provider_expanded['resource_changes'][0]['change']['after']['rule'][0]['statement'][0]['managed_rule_group_statement'][0]['rule_action_override'][0]['action_to_use']=[{
            'allow': [],
            'block': [],
            'captcha': [],
            'challenge': [],
            'count': [{'custom_request_handling': []}],
        }]
        self.assertEqual(guard.validate(provider_expanded,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET),[])

        unsafe_count=copy.deepcopy(provider_expanded)
        unsafe_count['resource_changes'][0]['change']['after']['rule'][0]['statement'][0]['managed_rule_group_statement'][0]['rule_action_override'][0]['action_to_use'][0]['count']=[{'custom_request_handling':[{'insert_header':[{'name':'X-Test','value':'unsafe'}]}]}]
        self.assertTrue(guard.validate(unsafe_count,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

        wrong_action=copy.deepcopy(plan)
        wrong_action['resource_changes'][0]['change']['after']['rule'][0]['statement'][0]['managed_rule_group_statement'][0]['rule_action_override'][0]['action_to_use']=[{'allow':[{}]}]
        self.assertTrue(guard.validate(wrong_action,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

        extra_change=copy.deepcopy(plan)
        extra_change['resource_changes'][0]['change']['after']['rule'][0]['priority']=11
        self.assertTrue(guard.validate(extra_change,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

    def test_accepts_only_bounded_profile_media_body_xss_exception(self):
        before={
            'id':guard.WAF_ID,
            'rule':[
                common_rule([count_override('SizeRestrictions_BODY')]),
                rate_rule(),
            ],
        }
        after=copy.deepcopy(before)
        after['rule'][0]['statement'][0]['managed_rule_group_statement'][0]['rule_action_override'].append(
            count_override('CrossSiteScripting_BODY')
        )
        after['rule'].insert(1, body_xss_rule())
        plan={'resource_changes':[
            {'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['update'],'before':before,'after':after}},
            {'address':'aws_cloudfront_distribution.app','mode':'managed','change':{'actions':['no-op'],'after':cloudfront_after()}},
            function_change(),
        ]}
        self.assertEqual(guard.validate(plan,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET),[])

        broad_path=copy.deepcopy(plan)
        broad_path['resource_changes'][0]['change']['after']['rule'][1]['statement'][0]['and_statement'][0]['statement'][1]['not_statement'][0]['statement'][0]['and_statement'][0]['statement'][1]['byte_match_statement'][0]['search_string']='/'
        self.assertTrue(guard.validate(broad_path,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

        broad_method=copy.deepcopy(plan)
        broad_method['resource_changes'][0]['change']['after']['rule'][1]['statement'][0]['and_statement'][0]['statement'][1]['not_statement'][0]['statement'][0]['and_statement'][0]['statement'][0]['byte_match_statement'][0]['search_string']='GET'
        self.assertTrue(guard.validate(broad_method,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

        wrong_label=copy.deepcopy(plan)
        wrong_label['resource_changes'][0]['change']['after']['rule'][1]['statement'][0]['and_statement'][0]['statement'][0]['label_match_statement'][0]['key']='awswaf:managed:aws:core-rule-set:CrossSiteScripting_QueryArguments'
        self.assertTrue(guard.validate(wrong_label,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

        removed_rate_limit=copy.deepcopy(plan)
        removed_rate_limit['resource_changes'][0]['change']['after']['rule'] = removed_rate_limit['resource_changes'][0]['change']['after']['rule'][:2]
        self.assertTrue(guard.validate(removed_rate_limit,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

    def test_accepts_bounded_creation_and_rejects_unsafe_variants(self):
        cf=cloudfront_after()
        plan={'resource_changes':[{'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['no-op'],'after':{'id':guard.WAF_ID}}},{'address':'aws_cloudfront_distribution.app','mode':'managed','change':{'actions':['create'],'after':cf}},function_change()], 'planned_values':{'root_module':{'resources':[{'address':'data.aws_cloudfront_cache_policy.caching_disabled','values':{'name':'Managed-CachingDisabled','id':guard.CACHE_POLICY_ID}},{'address':'data.aws_cloudfront_origin_request_policy.all_viewer_except_host','values':{'name':'Managed-AllViewerExceptHostHeader','id':guard.ORIGIN_POLICY_ID}}]}}}
        self.assertEqual(guard.validate(plan,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET),[])
        updated=copy.deepcopy(plan)
        updated['resource_changes'][1]['change']['actions']=['update']
        self.assertEqual(guard.validate(updated,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET),[])
        for address,actions in [('aws_ecs_service.app',['update']),('aws_route53_record.production',['create'])]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'].append({'address':address,'mode':'managed','change':{'actions':actions}})
            self.assertTrue(guard.validate(bad,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))
        bad=copy.deepcopy(plan)
        bad['resource_changes'][0]['change']['actions']=['delete','create']
        self.assertTrue(guard.validate(bad,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))
        null_alias=copy.deepcopy(plan)
        null_alias['resource_changes'][1]['change']['after']['aliases']=None
        self.assertTrue(guard.validate(null_alias,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))
        for key,value in [('http_port',81),('origin_protocol_policy','http-only'),('origin_protocol_policy','match-viewer')]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'][1]['change']['after']['origin'][0]['custom_origin_config'][0][key]=value
            self.assertTrue(guard.validate(bad,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))
        unknown=copy.deepcopy(plan)
        unknown['resource_changes'][1]['change']['after_unknown']={'aliases':True}
        self.assertTrue(guard.validate(unknown,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))
        for key,value in [('aliases',['seaandshore.in']),('web_acl_id','wrong-acl'),('origin',[{'domain_name':'wrong-origin'}]),('enabled',False)]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'][1]['change']['after'][key]=value
            self.assertTrue(guard.validate(bad,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))
        for bad_header in [[], [{'name':'X-Forwarded-Host','value':'evil.example.com'}], [{'name':'Host','value':guard.FORWARDED_HOST}]]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'][1]['change']['after']['origin'][0]['custom_header']=bad_header
            self.assertTrue(guard.validate(bad,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))
        # Round 14 (1.4): the origin secret header is required, exact, and never echoed.
        forwarded={'name':'X-Forwarded-Host','value':guard.FORWARDED_HOST}
        wrong_secret='W'*48
        for bad_header in [[forwarded], [forwarded,{'name':'X-Origin-Verify','value':wrong_secret}], [forwarded,{'name':'X-Origin-Verify','value':SECRET},{'name':'X-Test','value':'extra'}]]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'][1]['change']['after']['origin'][0]['custom_header']=bad_header
            errors=guard.validate(bad,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET)
            self.assertTrue(errors)
            self.assertNotIn(SECRET,'\n'.join(errors))
            self.assertNotIn(wrong_secret,'\n'.join(errors))
        reordered=copy.deepcopy(plan)
        reordered['resource_changes'][1]['change']['after']['origin'][0]['custom_header']=list(reversed(guard.expected_custom_headers(SECRET)))
        self.assertEqual(guard.validate(reordered,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET),[])
        http_only=copy.deepcopy(plan)
        http_only['resource_changes'][1]['change']['after']['origin'][0]['custom_origin_config'][0]['origin_protocol_policy']='http-only'
        self.assertTrue(guard.validate(http_only,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))
        alb_origin=copy.deepcopy(plan)
        alb_origin['resource_changes'][1]['change']['after']['origin'][0]['domain_name']='alb.example.amazonaws.com'
        self.assertTrue(guard.validate(alb_origin,'alb.example.amazonaws.com',CERT_ARN,origin_verify=SECRET))
        for missing in [None,'','short',SECRET+'!']:
            self.assertIn('Origin verify secret (48 letters/digits) required',guard.validate(plan,ORIGIN_HOST,CERT_ARN,origin_verify=missing))

class SeanshoreDomainEdgeTests(unittest.TestCase):
    def base_plan(self, cf_actions=None, function_actions=None, redirect_edge_host=False):
        return {'resource_changes':[
            {'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['no-op'],'after':{'id':guard.WAF_ID}}},
            {'address':'aws_cloudfront_distribution.app','mode':'managed','change':{'actions':cf_actions or ['update'],'after':cloudfront_after()}},
            function_change(function_actions, redirect_edge_host),
        ]}

    def test_accepts_the_seanshore_alias_certificate_and_redirect_function_update(self):
        self.assertEqual(guard.validate(self.base_plan(),ORIGIN_HOST,CERT_ARN,origin_verify=SECRET),[])
        created=self.base_plan(function_actions=['create'])
        self.assertEqual(guard.validate(created,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET),[])
        updated_function=self.base_plan(function_actions=['update'], redirect_edge_host=True)
        self.assertEqual(guard.validate(updated_function,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET),[])

    def test_first_creation_may_leave_only_the_function_arn_unknown(self):
        plan=self.base_plan(function_actions=['create'])
        plan['resource_changes'][1]['change']['after']['default_cache_behavior'][0]['function_association']=[{'event_type':'viewer-request','function_arn':None}]
        plan['resource_changes'][1]['change']['after_unknown']={'default_cache_behavior':[{'function_association':[{'function_arn':True}]}]}
        self.assertEqual(guard.validate(plan,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET),[])

        not_created=copy.deepcopy(plan)
        not_created['resource_changes'][2]['change']['actions']=['no-op']
        self.assertTrue(guard.validate(not_created,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

        wider_unknown=copy.deepcopy(plan)
        wider_unknown['resource_changes'][1]['change']['after_unknown']={'default_cache_behavior':[{'function_association':True}]}
        self.assertTrue(guard.validate(wider_unknown,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

    def test_rejects_wrong_aliases_certificates_and_associations(self):
        for key,value in [
            ('aliases',[]),('aliases',None),('aliases',['seanshore.in']),('aliases',['seanshore.in','www.seanshore.in','seaandshore.in']),
            # Domain move: the canonical names alone, or seanshore.net without its www name, are refused.
            ('aliases',['seanshore.in','www.seanshore.in']),('aliases',['seanshore.in','www.seanshore.in','seanshore.net']),
            ('aliases',['seanshore.in','www.seanshore.in','seanshore.net','www.seanshore.net','seaandshore.in']),
            ('viewer_certificate',[{'cloudfront_default_certificate':True}]),
            ('viewer_certificate',[{'acm_certificate_arn':CERT_ARN,'ssl_support_method':'vip','minimum_protocol_version':'TLSv1.2_2021'}]),
            ('viewer_certificate',[{'acm_certificate_arn':CERT_ARN,'ssl_support_method':'sni-only','minimum_protocol_version':'TLSv1'}]),
            ('viewer_certificate',[{'acm_certificate_arn':guard.CERTIFICATE_ARN_PREFIX+'other','ssl_support_method':'sni-only','minimum_protocol_version':'TLSv1.2_2021'}]),
        ]:
            bad=self.base_plan()
            bad['resource_changes'][1]['change']['after'][key]=value
            self.assertTrue(guard.validate(bad,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET), f'{key}={value!r} must be rejected')

        for association in [
            [],
            [{'event_type':'viewer-response','function_arn':guard.FUNCTION_ARN}],
            [{'event_type':'viewer-request','function_arn':'arn:aws:cloudfront::310356785722:function/other'}],
            [{'event_type':'viewer-request','function_arn':guard.FUNCTION_ARN},{'event_type':'viewer-response','function_arn':guard.FUNCTION_ARN}],
        ]:
            bad=self.base_plan()
            bad['resource_changes'][1]['change']['after']['default_cache_behavior'][0]['function_association']=association
            self.assertTrue(guard.validate(bad,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

        lambda_edge=self.base_plan()
        lambda_edge['resource_changes'][1]['change']['after']['default_cache_behavior'][0]['lambda_function_association']=[{'event_type':'viewer-request','lambda_arn':'arn:aws:lambda:us-east-1:310356785722:function:x:1'}]
        self.assertTrue(guard.validate(lambda_edge,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

        for wrong_cert in ['', 'arn:aws:acm:ap-south-1:310356785722:certificate/abc', 'arn:aws:acm:us-east-1:999999999999:certificate/abc']:
            self.assertTrue(guard.validate(self.base_plan(),ORIGIN_HOST,wrong_cert,origin_verify=SECRET))

    def test_rejects_redirect_function_drift(self):
        missing=self.base_plan()
        missing['resource_changes']=missing['resource_changes'][:2]
        self.assertTrue(guard.validate(missing,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

        for key,value in [
            ('name','sea-n-shore-staging-other'),('runtime','cloudfront-js-1.0'),('publish',False),
            ('code',guard.rendered_function_code(False).replace('seanshore.in','evil.example')),
            ('code',guard.rendered_function_code(False)+'\nhandler = function(event) { return event.request }'),
            ('key_value_store_associations',['arn:aws:cloudfront::310356785722:key-value-store/x']),
        ]:
            bad=self.base_plan()
            bad['resource_changes'][2]['change']['after'][key]=value
            self.assertTrue(guard.validate(bad,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET), f'{key} drift must be rejected')

        unknown_code=self.base_plan(function_actions=['update'])
        unknown_code['resource_changes'][2]['change']['after_unknown']={'code':True}
        self.assertTrue(guard.validate(unknown_code,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

        replaced=self.base_plan(function_actions=['delete','create'])
        self.assertTrue(guard.validate(replaced,ORIGIN_HOST,CERT_ARN,origin_verify=SECRET))

    def test_rendered_code_matches_the_template_for_both_switch_values(self):
        disabled=guard.rendered_function_code(False)
        enabled=guard.rendered_function_code(True)
        self.assertIn("var REDIRECT_EDGE_HOST = false;", disabled)
        self.assertIn("var REDIRECT_EDGE_HOST = true;", enabled)
        self.assertIn("var CANONICAL_HOST = 'seanshore.in';", disabled)
        self.assertIn("var EDGE_HOST = 'd3prih0q6jofyr.cloudfront.net';", disabled)
        self.assertNotIn('${', disabled)
        self.assertNotIn('${', enabled)



def ordered_behavior(path, cache_policy_id):
    return {'path_pattern':path,'target_origin_id':'sea-n-shore-staging-alb','viewer_protocol_policy':'redirect-to-https','allowed_methods':['HEAD','GET'],'cached_methods':['GET','HEAD'],'compress':True,'cache_policy_id':cache_policy_id,'origin_request_policy_id':'','lambda_function_association':[],'function_association':[{'event_type':'viewer-request','function_arn':guard.FUNCTION_ARN}]}


def image_policy_after(cookie_behavior='none', headers=('Accept',), queries=('url','w','q')):
    return {'id':'image-policy-id','min_ttl':0,'default_ttl':86400,'max_ttl':31536000,'parameters_in_cache_key_and_forwarded_to_origin':[{'cookies_config':[{'cookie_behavior':cookie_behavior}],'headers_config':[{'header_behavior':'whitelist','headers':[{'items':list(headers)}]}],'query_strings_config':[{'query_string_behavior':'whitelist','query_strings':[{'items':list(queries)}]}]}]}


def public_logo_policy_after(policy_id='logo-policy-id', **overrides):
    after = {
        'id': policy_id, 'min_ttl': 0, 'default_ttl': 0, 'max_ttl': 3600,
        'parameters_in_cache_key_and_forwarded_to_origin': [{
            'enable_accept_encoding_brotli': True, 'enable_accept_encoding_gzip': True,
            'cookies_config': [{'cookie_behavior': overrides.pop('cookie_behavior', 'none'), 'cookies': overrides.pop('cookies', [])}],
            'headers_config': [{'header_behavior': overrides.pop('header_behavior', 'none'), 'headers': overrides.pop('headers', [])}],
            'query_strings_config': [{'query_string_behavior': overrides.pop('query', 'whitelist'), 'query_strings': [{'items': list(overrides.pop('queries', ['v']))}]}],
        }],
    }
    after.update(overrides)
    return after


def logo_policy_change(actions=('no-op',), after=None):
    return {'address':guard.PUBLIC_LOGO_POLICY_ADDRESS,'mode':'managed','change':{'actions':list(actions),'after':after or public_logo_policy_after()}}


def behavior_policy_id(policy, image_policy='image-policy-id', logo_policy='logo-policy-id'):
    return {'optimized': guard.CACHING_OPTIMIZED_POLICY_ID, 'next_image': image_policy, 'public_logo': logo_policy}[policy]


class EdgeCachingTests(unittest.TestCase):
    """Round 14 (3.1): only hashed assets, public brand images and optimized images are cached."""

    def plan(self, behaviors, policy_actions=('no-op',), policy_after=None, unknown=None):
        cf = cloudfront_after()
        cf['ordered_cache_behavior'] = behaviors
        change = {'actions':['update'],'after':cf}
        if unknown is not None:
            change['after_unknown'] = {'ordered_cache_behavior':unknown}
        return {'resource_changes':[
            {'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['no-op'],'after':{'id':guard.WAF_ID}}},
            {'address':'aws_cloudfront_distribution.app','mode':'managed','change':change},
            function_change(),
            {'address':guard.NEXT_IMAGE_POLICY_ADDRESS,'mode':'managed','change':{'actions':list(policy_actions),'after':policy_after or image_policy_after()}},
            logo_policy_change(),
        ]}

    def expected(self, image_policy='image-policy-id'):
        return [ordered_behavior(path, behavior_policy_id(policy, image_policy=image_policy)) for path, policy in guard.EXPECTED_ORDERED_BEHAVIORS]

    def errors(self, plan):
        return guard.validate(plan, ORIGIN_HOST, CERT_ARN, origin_verify=SECRET)

    def test_accepts_exactly_the_asset_and_image_behaviors(self):
        self.assertEqual(self.errors(self.plan(self.expected())), [])
        created = self.expected(image_policy=None)
        unknown = [{} for _ in created]
        unknown[1] = {'cache_policy_id': True}
        self.assertEqual(self.errors(self.plan(created, policy_actions=('create',), unknown=unknown)), [])

    def test_refuses_other_paths_order_methods_or_policies(self):
        extra = self.expected() + [ordered_behavior('/*', guard.CACHING_OPTIMIZED_POLICY_ID)]
        self.assertIn('Ordered cache behaviors must be exactly the static asset and image paths', self.errors(self.plan(extra)))
        self.assertIn('Ordered cache behaviors must be exactly the static asset and image paths', self.errors(self.plan(list(reversed(self.expected())))))
        post = self.expected(); post[0]['allowed_methods'] = ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']
        self.assertTrue(any('GET/HEAD' in e for e in self.errors(self.plan(post))))
        wrong_policy = self.expected(); wrong_policy[2]['cache_policy_id'] = 'some-other-policy'
        self.assertIn('Cache policy mismatch for /brand/*', self.errors(self.plan(wrong_policy)))
        no_redirect = self.expected(); no_redirect[0]['function_association'] = []
        self.assertIn('Ordered behavior must keep the canonical-host redirect: /_next/static/*', self.errors(self.plan(no_redirect)))
        unknown_origin = [{} for _ in self.expected()]; unknown_origin[0] = {'target_origin_id': True}
        self.assertIn('Unknown safety field in ordered behavior /_next/static/*: target_origin_id=true', self.errors(self.plan(self.expected(), unknown=unknown_origin)))

    def test_accepts_provider_computed_ttl_and_grpc_fields_only(self):
        # A real plan (edge run 37243020983) marks the new behaviors' TTLs and gRPC flag unknown.
        computed = [{'default_ttl': True, 'max_ttl': True, 'grpc_config': [{'enabled': True}]} for _ in self.expected()]
        self.assertEqual(self.errors(self.plan(self.expected(), unknown=computed)), [])
        # Edge run 37244080639: the provider marks the whole gRPC block unknown.
        whole_block = [{'default_ttl': True, 'max_ttl': True, 'grpc_config': True} for _ in self.expected()]
        self.assertEqual(self.errors(self.plan(self.expected(), unknown=whole_block)), [])
        grpc_on = self.expected(); grpc_on[0]['grpc_config'] = [{'enabled': True}]
        self.assertIn('Unknown safety field in ordered behavior /_next/static/*: grpc_config=[{"enabled": true}]', self.errors(self.plan(grpc_on, unknown=computed)))
        self.assertIn('Unknown safety field in ordered behavior /_next/static/*: grpc_config=true', self.errors(self.plan(grpc_on, unknown=whole_block)))
        min_ttl = [dict(item, min_ttl=True) for item in computed]
        self.assertIn('Unknown safety field in ordered behavior /_next/static/*: min_ttl=true', self.errors(self.plan(self.expected(), unknown=min_ttl)))

    def test_image_policy_never_keys_on_cookies(self):
        for after in [image_policy_after(cookie_behavior='all'), image_policy_after(headers=('Accept','Cookie')), image_policy_after(queries=('url','w','q','token'))]:
            self.assertIn('Image cache policy must key only on url, w, q and Accept, never cookies', self.errors(self.plan(self.expected(), policy_actions=('update',), policy_after=after)))


def public_pages_policy_after(policy_id='pages-policy-id', **overrides):
    after = {
        'id': policy_id, 'min_ttl': 0, 'default_ttl': 0, 'max_ttl': 300,
        'parameters_in_cache_key_and_forwarded_to_origin': [{
            'enable_accept_encoding_brotli': True, 'enable_accept_encoding_gzip': True,
            'cookies_config': [{'cookie_behavior': overrides.pop('cookie_behavior', 'whitelist'), 'cookies': [{'items': list(overrides.pop('cookies', ['sns_cognito_access', 'sns_cognito_refresh']))}]}],
            'headers_config': [{'header_behavior': 'whitelist', 'headers': [{'items': list(overrides.pop('headers', ['rsc', 'next-router-prefetch', 'next-router-state-tree', 'next-router-segment-prefetch', 'x-sns-viewer-host']))}]}],
            'query_strings_config': [{'query_string_behavior': overrides.pop('query', 'all')}],
        }],
    }
    after.update(overrides)
    return after


class PublicPagesCachePolicyTests(unittest.TestCase):
    """Round P3 (B4): pages may be cached only through the one bounded policy that honours the origin."""

    def plan(self, default_policy, policy_actions=('update',), policy_after=None, unknown_policy=False):
        cf = cloudfront_after()
        cf['default_cache_behavior'][0]['cache_policy_id'] = default_policy
        unknown = {'default_cache_behavior': [{'cache_policy_id': True}]} if unknown_policy else {}
        return {'resource_changes': [
            {'address': 'aws_wafv2_web_acl.edge', 'mode': 'managed', 'change': {'actions': ['no-op'], 'after': {'id': guard.WAF_ID}}},
            {'address': 'aws_cloudfront_distribution.app', 'mode': 'managed', 'change': {'actions': ['update'], 'after': cf, 'after_unknown': unknown}},
            function_change(),
            {'address': guard.PUBLIC_PAGES_POLICY_ADDRESS, 'mode': 'managed', 'change': {'actions': list(policy_actions), 'after': policy_after or public_pages_policy_after()}},
        ]}

    def errors(self, plan):
        return guard.validate(plan, ORIGIN_HOST, CERT_ARN, origin_verify=SECRET)

    def test_accepts_the_page_policy_on_the_default_behavior(self):
        self.assertEqual(self.errors(self.plan('pages-policy-id')), [])
        created = public_pages_policy_after(policy_id=None)
        self.assertEqual(self.errors(self.plan(None, policy_actions=('create',), policy_after=created, unknown_policy=True)), [])

    def test_still_accepts_caching_disabled_for_pages(self):
        self.assertEqual(self.errors(self.plan(guard.CACHE_POLICY_ID)), [])

    def test_refuses_any_other_policy_on_the_default_behavior(self):
        for policy in [guard.CACHING_OPTIMIZED_POLICY_ID, 'some-other-policy']:
            self.assertIn('HTTPS/cache policy mismatch', self.errors(self.plan(policy)))
        # An unknown policy id is accepted only while the page policy itself is being created.
        self.assertTrue(any('Unknown safety field' in e for e in self.errors(self.plan(None, unknown_policy=True))))

    def test_page_policy_never_caches_what_the_origin_did_not_mark_or_mixes_sessions(self):
        message = 'Page cache policy must store only origin-marked public responses (TTL 0/0/300), keyed on the session cookies, RSC headers and query'
        for after in [
            public_pages_policy_after(default_ttl=60),
            public_pages_policy_after(min_ttl=1),
            public_pages_policy_after(max_ttl=3600),
            public_pages_policy_after(cookie_behavior='none'),
            public_pages_policy_after(cookies=['sns_cognito_access']),
            public_pages_policy_after(headers=['next-router-prefetch', 'next-router-state-tree']),
            # Domain move: without the viewer host in the key, one domain's cached page could be served on the other.
            public_pages_policy_after(headers=['rsc', 'next-router-prefetch', 'next-router-state-tree', 'next-router-segment-prefetch']),
            public_pages_policy_after(query='none'),
        ]:
            self.assertIn(message, self.errors(self.plan('pages-policy-id', policy_after=after)))
        self.assertIn('Page cache policy must be create/update/no-op', self.errors(self.plan('pages-policy-id', policy_actions=('delete', 'create'))))


class PublicLogoCachingTests(unittest.TestCase):
    """Request cuts (owner-approved 18 Nov): verified organizations' logos are cached once, never keyed on cookies."""

    def plan(self, behaviors=None, policy_actions=('no-op',), policy_after=None, unknown=None, include_policy=True):
        cf = cloudfront_after()
        cf['ordered_cache_behavior'] = behaviors if behaviors is not None else self.expected()
        change = {'actions':['update'],'after':cf}
        if unknown is not None:
            change['after_unknown'] = {'ordered_cache_behavior':unknown}
        resources = [
            {'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['no-op'],'after':{'id':guard.WAF_ID}}},
            {'address':'aws_cloudfront_distribution.app','mode':'managed','change':change},
            function_change(),
            {'address':guard.NEXT_IMAGE_POLICY_ADDRESS,'mode':'managed','change':{'actions':['no-op'],'after':image_policy_after()}},
        ]
        if include_policy:
            resources.append(logo_policy_change(policy_actions, policy_after))
        return {'resource_changes':resources}

    def expected(self, logo_policy='logo-policy-id'):
        return [ordered_behavior(path, behavior_policy_id(policy, logo_policy=logo_policy)) for path, policy in guard.EXPECTED_ORDERED_BEHAVIORS]

    def logo_index(self):
        return [path for path, _ in guard.EXPECTED_ORDERED_BEHAVIORS].index(guard.PUBLIC_LOGO_PATH)

    def errors(self, plan):
        return guard.validate(plan, ORIGIN_HOST, CERT_ARN, origin_verify=SECRET)

    def test_the_logo_behavior_is_last_and_only_for_the_public_logo_route(self):
        self.assertEqual(guard.EXPECTED_ORDERED_BEHAVIORS[-1], ('/api/public/company-logo/*', 'public_logo'))
        self.assertNotIn('/api/company-logo/*', [path for path, _ in guard.EXPECTED_ORDERED_BEHAVIORS])

    def test_accepts_the_logo_policy_updated_or_created(self):
        self.assertEqual(self.errors(self.plan()), [])
        self.assertEqual(self.errors(self.plan(policy_actions=('update',))), [])
        created = self.expected(logo_policy=None)
        unknown = [{} for _ in created]
        unknown[self.logo_index()] = {'cache_policy_id': True, 'default_ttl': True, 'max_ttl': True}
        self.assertEqual(self.errors(self.plan(created, policy_actions=('create',), policy_after=public_logo_policy_after(policy_id=None), unknown=unknown)), [])

    def test_an_unknown_logo_policy_id_needs_the_policy_to_be_created(self):
        unknown = [{} for _ in self.expected()]
        unknown[self.logo_index()] = {'cache_policy_id': True}
        self.assertIn('Unknown safety field in ordered behavior /api/public/company-logo/*: cache_policy_id=true', self.errors(self.plan(unknown=unknown)))
        self.assertIn('Cache policy mismatch for /api/public/company-logo/*', self.errors(self.plan(self.expected(logo_policy=None))))

    def test_refuses_the_logo_path_on_any_other_policy_or_without_its_policy(self):
        for policy in [guard.CACHING_OPTIMIZED_POLICY_ID, guard.CACHE_POLICY_ID, 'pages-policy-id', 'image-policy-id']:
            self.assertIn('Cache policy mismatch for /api/public/company-logo/*', self.errors(self.plan(self.expected(logo_policy=policy))))
        self.assertIn('Cache policy mismatch for /api/public/company-logo/*', self.errors(self.plan(include_policy=False)))
        self.assertIn('Cache policy mismatch for /api/public/company-logo/*', self.errors(self.plan(self.expected(logo_policy=None), include_policy=False)))
        self.assertIn('Public logo cache policy must be create/update/no-op', self.errors(self.plan(policy_actions=('delete', 'create'))))

    def test_refuses_forwarding_cookies_to_the_origin_or_other_methods(self):
        message = 'Ordered behavior must be GET/HEAD, HTTPS, compressed, without origin request policy: /api/public/company-logo/*'
        with_cookies = self.expected(); with_cookies[self.logo_index()]['origin_request_policy_id'] = guard.ORIGIN_POLICY_ID
        self.assertIn(message, self.errors(self.plan(with_cookies)))
        post = self.expected(); post[self.logo_index()]['allowed_methods'] = ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']
        self.assertIn(message, self.errors(self.plan(post)))
        no_redirect = self.expected(); no_redirect[self.logo_index()]['function_association'] = []
        self.assertIn('Ordered behavior must keep the canonical-host redirect: /api/public/company-logo/*', self.errors(self.plan(no_redirect)))

    def test_refuses_dropping_moving_or_widening_the_logo_path(self):
        message = 'Ordered cache behaviors must be exactly the static asset and image paths'
        self.assertIn(message, self.errors(self.plan(self.expected()[:-1])))
        self.assertIn(message, self.errors(self.plan([self.expected()[-1]] + self.expected()[:-1])))
        wider = self.expected(); wider[self.logo_index()]['path_pattern'] = '/api/*'
        self.assertIn(message, self.errors(self.plan(wider)))
        signed_in = self.expected(); signed_in[self.logo_index()]['path_pattern'] = '/api/company-logo/*'
        self.assertIn(message, self.errors(self.plan(signed_in)))

    def test_logo_policy_never_keys_on_or_forwards_cookies_and_honours_the_origin(self):
        message = 'Public logo cache policy must key only on the path and v (no cookies or headers), storing only origin-marked public responses for at most an hour (TTL 0/0/3600)'
        for after in [
            public_logo_policy_after(cookie_behavior='all'),
            public_logo_policy_after(cookie_behavior='whitelist', cookies=[{'items': ['sns_cognito_access']}]),
            public_logo_policy_after(header_behavior='whitelist', headers=[{'items': ['Cookie']}]),
            public_logo_policy_after(query='all'),
            public_logo_policy_after(queries=['v', 'token']),
            public_logo_policy_after(default_ttl=3600),
            public_logo_policy_after(min_ttl=60),
            public_logo_policy_after(max_ttl=86400),
        ]:
            self.assertIn(message, self.errors(self.plan(policy_actions=('update',), policy_after=after)))
        # Checked on a no-op too: the live policy must already be safe.
        self.assertIn(message, self.errors(self.plan(policy_after=public_logo_policy_after(cookie_behavior='all'))))

    def test_the_terraform_matches_the_checker(self):
        tf = (Path(__file__).resolve().parents[2] / 'infra' / 'aws' / 'app' / 'edge.tf').read_text()
        policy = tf[tf.index('resource "aws_cloudfront_cache_policy" "public_company_logo" {'):]
        policy = policy[:policy.index('\n}\n')]
        for needle in ['min_ttl     = 0\n', 'default_ttl = 0\n', 'max_ttl     = 3600\n', 'cookie_behavior = "none"', 'header_behavior = "none"',
                       'query_string_behavior = "whitelist"', 'items = ["v"]']:
            self.assertIn(needle, policy)
        self.assertNotIn('whitelist"\n      cookies', policy)
        paths = re.findall(r'path_pattern\s+= "([^"]+)"', tf)
        self.assertEqual(paths, ['/m/*'] + [path for path, _ in guard.EXPECTED_ORDERED_BEHAVIORS])
        logo = tf[tf.index('path_pattern           = "/api/public/company-logo/*"'):]
        logo = logo[:logo.index('\n  }\n')]
        self.assertIn('cache_policy_id        = aws_cloudfront_cache_policy.public_company_logo.id', logo)
        self.assertNotIn('origin_request_policy_id', logo)


def media_origin(**overrides):
    origin = {'domain_name':guard.MEDIA_ORIGIN_DOMAIN,'origin_id':guard.MEDIA_ORIGIN_ID,'origin_path':'','origin_access_control_id':'oac-id','custom_header':[],'custom_origin_config':[],'s3_origin_config':[]}
    origin.update(overrides)
    return origin


def media_behavior(**overrides):
    behavior = {'path_pattern':'/m/*','target_origin_id':guard.MEDIA_ORIGIN_ID,'viewer_protocol_policy':'redirect-to-https','allowed_methods':['GET','HEAD'],'cached_methods':['HEAD','GET'],'compress':False,'cache_policy_id':'media-policy-id','origin_request_policy_id':'','trusted_key_groups':['key-group-id'],'trusted_signers':[],'lambda_function_association':[],'function_association':[]}
    behavior.update(overrides)
    return behavior


def media_policy_after(policy_id='media-policy-id', **overrides):
    after = {'id':policy_id,'min_ttl':86400,'default_ttl':31536000,'max_ttl':31536000,'parameters_in_cache_key_and_forwarded_to_origin':[{
        'enable_accept_encoding_brotli':False,'enable_accept_encoding_gzip':False,
        'cookies_config':[{'cookie_behavior':overrides.pop('cookie_behavior','none')}],
        'headers_config':[{'header_behavior':overrides.pop('header_behavior','none')}],
        'query_strings_config':[{'query_string_behavior':overrides.pop('query','none')}],
    }]}
    after.update(overrides)
    return after


def rate_rule_with_media_scope(search='/m/'):
    rule = rate_rule()
    rule['statement'][0]['rate_based_statement'][0]['scope_down_statement'] = [{'not_statement':[{'statement':[{'byte_match_statement':[{
        'field_to_match':[{'uri_path':[{}]}],'positional_constraint':'STARTS_WITH','search_string':search,'text_transformation':[{'priority':0,'type':'NONE'}],
    }]}]}]}]
    return rule


class SignedMediaTests(unittest.TestCase):
    """Round P3 (B7): one private media origin and one signed /m/* behavior, nothing looser."""

    def plan(self, behaviors=None, origins=None, policy_actions=('create',), policy_after=None, waf=None, unknown=None):
        cf = cloudfront_after()
        cf['origin'] = cf['origin'] + (origins if origins is not None else [media_origin()])
        cf['ordered_cache_behavior'] = behaviors if behaviors is not None else self.behaviors()
        change = {'actions':['update'],'after':cf}
        if unknown is not None:
            change['after_unknown'] = {'ordered_cache_behavior':unknown}
        return {'resource_changes':[
            waf or {'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['no-op'],'after':{'id':guard.WAF_ID}}},
            {'address':'aws_cloudfront_distribution.app','mode':'managed','change':change},
            function_change(),
            {'address':guard.NEXT_IMAGE_POLICY_ADDRESS,'mode':'managed','change':{'actions':['no-op'],'after':image_policy_after()}},
            logo_policy_change(),
            {'address':guard.MEDIA_POLICY_ADDRESS,'mode':'managed','change':{'actions':list(policy_actions),'after':policy_after or media_policy_after()}},
            {'address':guard.MEDIA_KEY_GROUP_ADDRESS,'mode':'managed','change':{'actions':['no-op'],'after':{'id':'key-group-id'}}},
            {'address':guard.MEDIA_OAC_ADDRESS,'mode':'managed','change':{'actions':['no-op'],'after':{'id':'oac-id'}}},
        ]}

    def behaviors(self, media=None):
        rest = [ordered_behavior(path, behavior_policy_id(policy)) for path, policy in guard.EXPECTED_ORDERED_BEHAVIORS]
        return [media or media_behavior()] + rest

    def errors(self, plan):
        return guard.validate(plan, ORIGIN_HOST, CERT_ARN, origin_verify=SECRET)

    def test_accepts_the_private_media_origin_and_signed_behavior(self):
        self.assertEqual(self.errors(self.plan()), [])
        created = self.behaviors(media_behavior(cache_policy_id=None))
        unknown = [{'cache_policy_id': True, 'default_ttl': True, 'max_ttl': True}] + [{} for _ in guard.EXPECTED_ORDERED_BEHAVIORS]
        self.assertEqual(self.errors(self.plan(created, policy_after=media_policy_after(policy_id=None), unknown=unknown)), [])

    def test_refuses_unsigned_or_function_backed_media(self):
        for broken, message in [
            (media_behavior(trusted_key_groups=[]), 'Media behavior must trust exactly the media key group'),
            (media_behavior(trusted_key_groups=['other-group']), 'Media behavior must trust exactly the media key group'),
            (media_behavior(function_association=[{'event_type':'viewer-request','function_arn':guard.FUNCTION_ARN}]), 'Media behavior must be signed GET/HEAD from the media origin over HTTPS, with no functions'),
            (media_behavior(target_origin_id='sea-n-shore-staging-alb'), 'Media behavior must be signed GET/HEAD from the media origin over HTTPS, with no functions'),
            (media_behavior(allowed_methods=['GET','HEAD','OPTIONS','PUT','POST','PATCH','DELETE']), 'Media behavior must be signed GET/HEAD from the media origin over HTTPS, with no functions'),
            (media_behavior(viewer_protocol_policy='allow-all'), 'Media behavior must be signed GET/HEAD from the media origin over HTTPS, with no functions'),
            (media_behavior(cache_policy_id=guard.CACHING_OPTIMIZED_POLICY_ID), 'Cache policy mismatch for /m/*'),
        ]:
            self.assertIn(message, self.errors(self.plan(self.behaviors(broken))))

    def test_refuses_a_public_or_altered_media_origin(self):
        for origin, message in [
            (media_origin(domain_name='other-bucket.s3.ap-south-1.amazonaws.com'), 'Media origin must be the private media bucket with no path, headers or custom config'),
            (media_origin(origin_path='/private'), 'Media origin must be the private media bucket with no path, headers or custom config'),
            (media_origin(custom_header=[{'name':'X','value':'y'}]), 'Media origin must be the private media bucket with no path, headers or custom config'),
            (media_origin(origin_access_control_id=''), 'Media origin must read through the media origin access control'),
            (media_origin(origin_access_control_id='other-oac'), 'Media origin must read through the media origin access control'),
        ]:
            self.assertIn(message, self.errors(self.plan(origins=[origin])))
        self.assertIn('A media origin needs the signed media behavior first', self.errors(self.plan(behaviors=self.behaviors()[1:])))
        self.assertIn('The signed media behavior needs the media origin', self.errors(self.plan(origins=[])))
        self.assertIn('At most one media origin', self.errors(self.plan(origins=[media_origin(), media_origin()])))

    def test_media_policy_keys_on_the_path_only(self):
        message = 'Media cache policy must key on the path only (no cookies, headers or query) for one year'
        for after in [media_policy_after(query='all'), media_policy_after(cookie_behavior='all'), media_policy_after(header_behavior='whitelist'), media_policy_after(min_ttl=0)]:
            self.assertIn(message, self.errors(self.plan(policy_after=after)))
        self.assertIn('Media cache policy must be create/update/no-op', self.errors(self.plan(policy_actions=('delete', 'create'))))

    def test_rate_limit_may_stop_counting_signed_media_and_nothing_else(self):
        current = {'id':guard.WAF_ID,'rule':[common_rule([count_override('SizeRestrictions_BODY'), count_override('CrossSiteScripting_BODY')]), body_xss_rule(), rate_rule()]}
        scoped = copy.deepcopy(current); scoped['rule'][2] = rate_rule_with_media_scope()
        def waf(before, after):
            return {'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['update'],'before':before,'after':after}}
        self.assertEqual(self.errors(self.plan(waf=waf(current, scoped))), [])
        wrong_path = copy.deepcopy(current); wrong_path['rule'][2] = rate_rule_with_media_scope('/')
        self.assertTrue(self.errors(self.plan(waf=waf(current, wrong_path))))
        higher_limit = copy.deepcopy(scoped); higher_limit['rule'][2]['statement'][0]['rate_based_statement'][0]['limit'] = 10000
        self.assertTrue(self.errors(self.plan(waf=waf(current, higher_limit))))
        removed = copy.deepcopy(scoped)
        self.assertTrue(self.errors(self.plan(waf=waf(removed, current))))


def signed_out_rate_rule(cookie='sns_cognito_refresh'):
    rule = rate_rule_with_media_scope()
    media = rule['statement'][0]['rate_based_statement'][0]['scope_down_statement'][0]
    rule['statement'][0]['rate_based_statement'][0]['scope_down_statement'] = [{'and_statement':[{'statement':[
        media,
        {'not_statement':[{'statement':[{'size_constraint_statement':[{
            'comparison_operator':'GT','size':0,
            'field_to_match':[{'cookies':[{'match_pattern':[{'all':[],'included_cookies':[cookie],'excluded_cookies':[]}],'match_scope':'VALUE','oversize_handling':'MATCH'}]}],
            'text_transformation':[{'priority':0,'type':'NONE'}],
        }]}]}]},
    ]}]}]
    return rule


def ship_rule(name, priority, metric, aggregate, limit, custom_key=None):
    rate = {'aggregate_key_type':aggregate,'evaluation_window_sec':300,'limit':limit,'forwarded_ip_config':[],
            'scope_down_statement':rate_rule_with_media_scope()['statement'][0]['rate_based_statement'][0]['scope_down_statement']}
    if custom_key is not None:
        rate['custom_key'] = custom_key
    return {'name':name,'priority':priority,'action':[{'block':[{}]}],'captcha_config':[],'rule_label':[],
            'statement':[{'rate_based_statement':[rate]}],
            'visibility_config':[{'cloudwatch_metrics_enabled':True,'metric_name':'sea-n-shore-staging-'+metric,'sampled_requests_enabled':True}]}


def session_rule(limit=1000, cookie='sns_cognito_refresh'):
    key = [{'cookie':[{'name':cookie,'text_transformation':[{'priority':0,'type':'NONE'}]}],'header':[],'ip':[],'query_argument':[]}]
    return ship_rule('PerSessionRateLimit', 21, 'session-rate-limit', 'CUSTOM_KEYS', limit, key)


def ceiling_rule(limit=20000):
    return ship_rule('PerIpCeiling', 22, 'ip-ceiling', 'IP', limit)


class ShipIpRateLimitTests(SignedMediaTests):
    """ARCH decision 6: signed-in traffic limited per session, a per-IP ceiling, nothing looser."""

    def current(self):
        return {'id':guard.WAF_ID,'rule':[common_rule([count_override('SizeRestrictions_BODY'), count_override('CrossSiteScripting_BODY')]), body_xss_rule(), rate_rule_with_media_scope()]}

    def shipped(self, rate=None, session=None, ceiling=None):
        waf = self.current()
        waf['rule'][2] = rate or signed_out_rate_rule()
        waf['rule'] += [r for r in (session if session is not None else session_rule(), ceiling if ceiling is not None else ceiling_rule()) if r]
        return waf

    def errors_for(self, before, after):
        return self.errors(self.plan(waf={'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['update'],'before':before,'after':after}}))

    def test_accepts_exactly_the_approved_ship_ip_rules(self):
        self.assertEqual(self.errors_for(self.current(), self.shipped()), [])

    def test_refuses_looser_or_partial_variants(self):
        for after in [
            self.shipped(session=session_rule(limit=5000)),
            self.shipped(session=session_rule(cookie='sns_cognito_access')),
            self.shipped(ceiling=ceiling_rule(limit=100000)),
            self.shipped(rate=signed_out_rate_rule(cookie='anything')),
            self.shipped(session=False),
            self.shipped(ceiling=False),
            self.shipped(rate=rate_rule_with_media_scope()),
            self.shipped(session=False, ceiling=False),
        ]:
            if after == self.current():
                continue
            self.assertTrue(self.errors_for(self.current(), after))
        higher = self.shipped(); higher['rule'][2]['statement'][0]['rate_based_statement'][0]['limit'] = 10000
        self.assertTrue(self.errors_for(self.current(), higher))

    def test_refuses_removing_the_ship_ip_rules_or_mixing_them_with_other_changes(self):
        self.assertTrue(self.errors_for(self.shipped(), self.current()))
        mixed = self.shipped(); mixed['rule'][0] = common_rule([count_override('SizeRestrictions_BODY')])
        self.assertTrue(self.errors_for(self.current(), mixed))
        unscoped_before = self.current(); unscoped_before['rule'][2] = rate_rule()
        self.assertTrue(self.errors_for(unscoped_before, self.shipped()))

    def test_the_terraform_matches_the_checker(self):
        tf = (Path(__file__).resolve().parents[2] / 'infra' / 'aws' / 'app' / 'edge.tf').read_text()
        for needle in ['name     = "PerSessionRateLimit"\n    priority = 21', 'name     = "PerIpCeiling"\n    priority = 22',
                       'aggregate_key_type    = "CUSTOM_KEYS"\n        evaluation_window_sec = 300\n        limit                 = 1000',
                       'aggregate_key_type    = "IP"\n        evaluation_window_sec = 300\n        limit                 = 20000',
                       'aggregate_key_type    = "IP"\n        evaluation_window_sec = 300\n        limit                 = 2000\n',
                       'name = "sns_cognito_refresh"', 'included_cookies = ["sns_cognito_refresh"]',
                       'metric_name                = "${local.name_prefix}-session-rate-limit"', 'metric_name                = "${local.name_prefix}-ip-ceiling"']:
            self.assertIn(needle, tf)
        self.assertEqual(tf.count('search_string         = "/m/"'), 3)


if __name__ == '__main__': unittest.main()
