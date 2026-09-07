import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('check-edge-plan.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

class EdgePlanTests(unittest.TestCase):
    def test_rejects_unrelated_changes_and_waf_recreation(self):
        for address, actions in [('aws_ecs_service.app', ['update']), ('aws_wafv2_web_acl.edge', ['delete','create']), ('aws_route53_record.production', ['create'])]:
            plan={'resource_changes':[{'address':address,'mode':'managed','change':{'actions':actions}}]}
            self.assertTrue(guard.validate(plan, 'alb.example.amazonaws.com'))
    def test_rejects_empty_plan_without_existing_waf(self):
        self.assertTrue(guard.validate({}, 'alb.example.amazonaws.com'))

    def test_accepts_bounded_creation_and_rejects_unsafe_variants(self):
        import copy
        cf={'web_acl_id':guard.WAF_ARN,'enabled':True,'aliases':[], 'viewer_certificate':[{'cloudfront_default_certificate':True}], 'origin':[{'domain_name':'alb.example.amazonaws.com','origin_id':'sea-n-shore-staging-alb','origin_path':'','custom_origin_config':[{'http_port':80,'https_port':443,'origin_protocol_policy':'http-only','origin_ssl_protocols':['TLSv1.2']}]}], 'default_cache_behavior':[{'target_origin_id':'sea-n-shore-staging-alb','viewer_protocol_policy':'redirect-to-https','cache_policy_id':guard.CACHE_POLICY_ID,'origin_request_policy_id':guard.ORIGIN_POLICY_ID,'allowed_methods':['DELETE','GET','HEAD','OPTIONS','PATCH','POST','PUT']}]}
        plan={'resource_changes':[{'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['no-op'],'after':{'id':guard.WAF_ID}}},{'address':'aws_cloudfront_distribution.app','mode':'managed','change':{'actions':['create'],'after':cf}}], 'planned_values':{'root_module':{'resources':[{'address':'data.aws_cloudfront_cache_policy.caching_disabled','values':{'name':'Managed-CachingDisabled','id':guard.CACHE_POLICY_ID}},{'address':'data.aws_cloudfront_origin_request_policy.all_viewer_except_host','values':{'name':'Managed-AllViewerExceptHostHeader','id':guard.ORIGIN_POLICY_ID}}]}}}
        self.assertEqual(guard.validate(plan,'alb.example.amazonaws.com'),[])
        for address,actions in [('aws_ecs_service.app',['update']),('aws_route53_record.production',['create'])]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'].append({'address':address,'mode':'managed','change':{'actions':actions}})
            self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com'))
        bad=copy.deepcopy(plan)
        bad['resource_changes'][0]['change']['actions']=['delete','create']
        self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com'))
        null_alias=copy.deepcopy(plan)
        null_alias['resource_changes'][1]['change']['after']['aliases']=None
        self.assertEqual(guard.validate(null_alias,'alb.example.amazonaws.com'),[])
        for key,value in [('http_port',81),('origin_protocol_policy','https-only')]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'][1]['change']['after']['origin'][0]['custom_origin_config'][0][key]=value
            self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com'))
        unknown=copy.deepcopy(plan)
        unknown['resource_changes'][1]['change']['after_unknown']={'aliases':True}
        self.assertTrue(guard.validate(unknown,'alb.example.amazonaws.com'))
        for key,value in [('aliases',['seaandshore.in']),('web_acl_id','wrong-acl'),('origin',[{'domain_name':'wrong-origin'}]),('enabled',False)]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'][1]['change']['after'][key]=value
            self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com'))

if __name__ == '__main__': unittest.main()
