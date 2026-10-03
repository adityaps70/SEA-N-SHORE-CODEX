import copy
import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('check-edge-plan.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


CERT_ARN = guard.CERTIFICATE_ARN_PREFIX + '0f6a5b3c-1d2e-4f70-8a9b-0c1d2e3f4a5b'


def cloudfront_after():
    return {'web_acl_id':guard.WAF_ARN,'enabled':True,'aliases':['www.seanshore.in','seanshore.in'], 'viewer_certificate':[{'acm_certificate_arn':CERT_ARN,'cloudfront_default_certificate':False,'iam_certificate_id':'','minimum_protocol_version':'TLSv1.2_2021','ssl_support_method':'sni-only'}], 'origin':[{'domain_name':'alb.example.amazonaws.com','origin_id':'sea-n-shore-staging-alb','origin_path':'','custom_header':guard.EXPECTED_CUSTOM_HEADERS,'custom_origin_config':[{'http_port':80,'https_port':443,'origin_protocol_policy':'http-only','origin_ssl_protocols':['TLSv1.2']}]}], 'default_cache_behavior':[{'target_origin_id':'sea-n-shore-staging-alb','viewer_protocol_policy':'redirect-to-https','cache_policy_id':guard.CACHE_POLICY_ID,'origin_request_policy_id':guard.ORIGIN_POLICY_ID,'allowed_methods':['DELETE','GET','HEAD','OPTIONS','PATCH','POST','PUT'],'function_association':[{'event_type':'viewer-request','function_arn':guard.FUNCTION_ARN}],'lambda_function_association':[]}]}


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
            self.assertTrue(guard.validate(plan, 'alb.example.amazonaws.com', CERT_ARN))

    def test_rejects_empty_plan_without_existing_waf(self):
        self.assertTrue(guard.validate({}, 'alb.example.amazonaws.com', CERT_ARN))

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
        self.assertEqual(guard.validate(plan,'alb.example.amazonaws.com',CERT_ARN),[])

        provider_expanded=copy.deepcopy(plan)
        provider_expanded['resource_changes'][0]['change']['after']['rule'][0]['statement'][0]['managed_rule_group_statement'][0]['rule_action_override'][0]['action_to_use']=[{
            'allow': [],
            'block': [],
            'captcha': [],
            'challenge': [],
            'count': [{'custom_request_handling': []}],
        }]
        self.assertEqual(guard.validate(provider_expanded,'alb.example.amazonaws.com',CERT_ARN),[])

        unsafe_count=copy.deepcopy(provider_expanded)
        unsafe_count['resource_changes'][0]['change']['after']['rule'][0]['statement'][0]['managed_rule_group_statement'][0]['rule_action_override'][0]['action_to_use'][0]['count']=[{'custom_request_handling':[{'insert_header':[{'name':'X-Test','value':'unsafe'}]}]}]
        self.assertTrue(guard.validate(unsafe_count,'alb.example.amazonaws.com',CERT_ARN))

        wrong_action=copy.deepcopy(plan)
        wrong_action['resource_changes'][0]['change']['after']['rule'][0]['statement'][0]['managed_rule_group_statement'][0]['rule_action_override'][0]['action_to_use']=[{'allow':[{}]}]
        self.assertTrue(guard.validate(wrong_action,'alb.example.amazonaws.com',CERT_ARN))

        extra_change=copy.deepcopy(plan)
        extra_change['resource_changes'][0]['change']['after']['rule'][0]['priority']=11
        self.assertTrue(guard.validate(extra_change,'alb.example.amazonaws.com',CERT_ARN))

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
        self.assertEqual(guard.validate(plan,'alb.example.amazonaws.com',CERT_ARN),[])

        broad_path=copy.deepcopy(plan)
        broad_path['resource_changes'][0]['change']['after']['rule'][1]['statement'][0]['and_statement'][0]['statement'][1]['not_statement'][0]['statement'][0]['and_statement'][0]['statement'][1]['byte_match_statement'][0]['search_string']='/'
        self.assertTrue(guard.validate(broad_path,'alb.example.amazonaws.com',CERT_ARN))

        broad_method=copy.deepcopy(plan)
        broad_method['resource_changes'][0]['change']['after']['rule'][1]['statement'][0]['and_statement'][0]['statement'][1]['not_statement'][0]['statement'][0]['and_statement'][0]['statement'][0]['byte_match_statement'][0]['search_string']='GET'
        self.assertTrue(guard.validate(broad_method,'alb.example.amazonaws.com',CERT_ARN))

        wrong_label=copy.deepcopy(plan)
        wrong_label['resource_changes'][0]['change']['after']['rule'][1]['statement'][0]['and_statement'][0]['statement'][0]['label_match_statement'][0]['key']='awswaf:managed:aws:core-rule-set:CrossSiteScripting_QueryArguments'
        self.assertTrue(guard.validate(wrong_label,'alb.example.amazonaws.com',CERT_ARN))

        removed_rate_limit=copy.deepcopy(plan)
        removed_rate_limit['resource_changes'][0]['change']['after']['rule'] = removed_rate_limit['resource_changes'][0]['change']['after']['rule'][:2]
        self.assertTrue(guard.validate(removed_rate_limit,'alb.example.amazonaws.com',CERT_ARN))

    def test_accepts_bounded_creation_and_rejects_unsafe_variants(self):
        cf=cloudfront_after()
        plan={'resource_changes':[{'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['no-op'],'after':{'id':guard.WAF_ID}}},{'address':'aws_cloudfront_distribution.app','mode':'managed','change':{'actions':['create'],'after':cf}},function_change()], 'planned_values':{'root_module':{'resources':[{'address':'data.aws_cloudfront_cache_policy.caching_disabled','values':{'name':'Managed-CachingDisabled','id':guard.CACHE_POLICY_ID}},{'address':'data.aws_cloudfront_origin_request_policy.all_viewer_except_host','values':{'name':'Managed-AllViewerExceptHostHeader','id':guard.ORIGIN_POLICY_ID}}]}}}
        self.assertEqual(guard.validate(plan,'alb.example.amazonaws.com',CERT_ARN),[])
        updated=copy.deepcopy(plan)
        updated['resource_changes'][1]['change']['actions']=['update']
        self.assertEqual(guard.validate(updated,'alb.example.amazonaws.com',CERT_ARN),[])
        for address,actions in [('aws_ecs_service.app',['update']),('aws_route53_record.production',['create'])]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'].append({'address':address,'mode':'managed','change':{'actions':actions}})
            self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com',CERT_ARN))
        bad=copy.deepcopy(plan)
        bad['resource_changes'][0]['change']['actions']=['delete','create']
        self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com',CERT_ARN))
        null_alias=copy.deepcopy(plan)
        null_alias['resource_changes'][1]['change']['after']['aliases']=None
        self.assertTrue(guard.validate(null_alias,'alb.example.amazonaws.com',CERT_ARN))
        for key,value in [('http_port',81),('origin_protocol_policy','https-only')]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'][1]['change']['after']['origin'][0]['custom_origin_config'][0][key]=value
            self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com',CERT_ARN))
        unknown=copy.deepcopy(plan)
        unknown['resource_changes'][1]['change']['after_unknown']={'aliases':True}
        self.assertTrue(guard.validate(unknown,'alb.example.amazonaws.com',CERT_ARN))
        for key,value in [('aliases',['seaandshore.in']),('web_acl_id','wrong-acl'),('origin',[{'domain_name':'wrong-origin'}]),('enabled',False)]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'][1]['change']['after'][key]=value
            self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com',CERT_ARN))
        for bad_header in [[], [{'name':'X-Forwarded-Host','value':'evil.example.com'}], [{'name':'Host','value':guard.FORWARDED_HOST}]]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'][1]['change']['after']['origin'][0]['custom_header']=bad_header
            self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com',CERT_ARN))

class SeanshoreDomainEdgeTests(unittest.TestCase):
    def base_plan(self, cf_actions=None, function_actions=None, redirect_edge_host=False):
        return {'resource_changes':[
            {'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['no-op'],'after':{'id':guard.WAF_ID}}},
            {'address':'aws_cloudfront_distribution.app','mode':'managed','change':{'actions':cf_actions or ['update'],'after':cloudfront_after()}},
            function_change(function_actions, redirect_edge_host),
        ]}

    def test_accepts_the_seanshore_alias_certificate_and_redirect_function_update(self):
        self.assertEqual(guard.validate(self.base_plan(),'alb.example.amazonaws.com',CERT_ARN),[])
        created=self.base_plan(function_actions=['create'])
        self.assertEqual(guard.validate(created,'alb.example.amazonaws.com',CERT_ARN),[])
        updated_function=self.base_plan(function_actions=['update'], redirect_edge_host=True)
        self.assertEqual(guard.validate(updated_function,'alb.example.amazonaws.com',CERT_ARN),[])

    def test_first_creation_may_leave_only_the_function_arn_unknown(self):
        plan=self.base_plan(function_actions=['create'])
        plan['resource_changes'][1]['change']['after']['default_cache_behavior'][0]['function_association']=[{'event_type':'viewer-request','function_arn':None}]
        plan['resource_changes'][1]['change']['after_unknown']={'default_cache_behavior':[{'function_association':[{'function_arn':True}]}]}
        self.assertEqual(guard.validate(plan,'alb.example.amazonaws.com',CERT_ARN),[])

        not_created=copy.deepcopy(plan)
        not_created['resource_changes'][2]['change']['actions']=['no-op']
        self.assertTrue(guard.validate(not_created,'alb.example.amazonaws.com',CERT_ARN))

        wider_unknown=copy.deepcopy(plan)
        wider_unknown['resource_changes'][1]['change']['after_unknown']={'default_cache_behavior':[{'function_association':True}]}
        self.assertTrue(guard.validate(wider_unknown,'alb.example.amazonaws.com',CERT_ARN))

    def test_rejects_wrong_aliases_certificates_and_associations(self):
        for key,value in [
            ('aliases',[]),('aliases',None),('aliases',['seanshore.in']),('aliases',['seanshore.in','www.seanshore.in','seaandshore.in']),
            ('viewer_certificate',[{'cloudfront_default_certificate':True}]),
            ('viewer_certificate',[{'acm_certificate_arn':CERT_ARN,'ssl_support_method':'vip','minimum_protocol_version':'TLSv1.2_2021'}]),
            ('viewer_certificate',[{'acm_certificate_arn':CERT_ARN,'ssl_support_method':'sni-only','minimum_protocol_version':'TLSv1'}]),
            ('viewer_certificate',[{'acm_certificate_arn':guard.CERTIFICATE_ARN_PREFIX+'other','ssl_support_method':'sni-only','minimum_protocol_version':'TLSv1.2_2021'}]),
        ]:
            bad=self.base_plan()
            bad['resource_changes'][1]['change']['after'][key]=value
            self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com',CERT_ARN), f'{key}={value!r} must be rejected')

        for association in [
            [],
            [{'event_type':'viewer-response','function_arn':guard.FUNCTION_ARN}],
            [{'event_type':'viewer-request','function_arn':'arn:aws:cloudfront::310356785722:function/other'}],
            [{'event_type':'viewer-request','function_arn':guard.FUNCTION_ARN},{'event_type':'viewer-response','function_arn':guard.FUNCTION_ARN}],
        ]:
            bad=self.base_plan()
            bad['resource_changes'][1]['change']['after']['default_cache_behavior'][0]['function_association']=association
            self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com',CERT_ARN))

        lambda_edge=self.base_plan()
        lambda_edge['resource_changes'][1]['change']['after']['default_cache_behavior'][0]['lambda_function_association']=[{'event_type':'viewer-request','lambda_arn':'arn:aws:lambda:us-east-1:310356785722:function:x:1'}]
        self.assertTrue(guard.validate(lambda_edge,'alb.example.amazonaws.com',CERT_ARN))

        for wrong_cert in ['', 'arn:aws:acm:ap-south-1:310356785722:certificate/abc', 'arn:aws:acm:us-east-1:999999999999:certificate/abc']:
            self.assertTrue(guard.validate(self.base_plan(),'alb.example.amazonaws.com',wrong_cert))

    def test_rejects_redirect_function_drift(self):
        missing=self.base_plan()
        missing['resource_changes']=missing['resource_changes'][:2]
        self.assertTrue(guard.validate(missing,'alb.example.amazonaws.com',CERT_ARN))

        for key,value in [
            ('name','sea-n-shore-staging-other'),('runtime','cloudfront-js-1.0'),('publish',False),
            ('code',guard.rendered_function_code(False).replace('seanshore.in','evil.example')),
            ('code',guard.rendered_function_code(False)+'\nhandler = function(event) { return event.request }'),
            ('key_value_store_associations',['arn:aws:cloudfront::310356785722:key-value-store/x']),
        ]:
            bad=self.base_plan()
            bad['resource_changes'][2]['change']['after'][key]=value
            self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com',CERT_ARN), f'{key} drift must be rejected')

        unknown_code=self.base_plan(function_actions=['update'])
        unknown_code['resource_changes'][2]['change']['after_unknown']={'code':True}
        self.assertTrue(guard.validate(unknown_code,'alb.example.amazonaws.com',CERT_ARN))

        replaced=self.base_plan(function_actions=['delete','create'])
        self.assertTrue(guard.validate(replaced,'alb.example.amazonaws.com',CERT_ARN))

    def test_rendered_code_matches_the_template_for_both_switch_values(self):
        disabled=guard.rendered_function_code(False)
        enabled=guard.rendered_function_code(True)
        self.assertIn("var REDIRECT_EDGE_HOST = false;", disabled)
        self.assertIn("var REDIRECT_EDGE_HOST = true;", enabled)
        self.assertIn("var CANONICAL_HOST = 'seanshore.in';", disabled)
        self.assertIn("var EDGE_HOST = 'd3prih0q6jofyr.cloudfront.net';", disabled)
        self.assertNotIn('${', disabled)
        self.assertNotIn('${', enabled)


if __name__ == '__main__': unittest.main()
