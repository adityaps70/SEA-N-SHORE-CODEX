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
        cf={'web_acl_id':guard.WAF_ARN,'enabled':True,'aliases':[], 'viewer_certificate':[{'cloudfront_default_certificate':True}], 'origin':[{'domain_name':'alb.example.amazonaws.com'}], 'default_cache_behavior':[{'viewer_protocol_policy':'redirect-to-https','cache_policy_id':'cache-id','origin_request_policy_id':'request-id','allowed_methods':['DELETE','GET','HEAD','OPTIONS','PATCH','POST','PUT']}]}
        plan={'resource_changes':[{'address':'aws_wafv2_web_acl.edge','mode':'managed','change':{'actions':['no-op'],'after':{'id':guard.WAF_ID}}},{'address':'aws_cloudfront_distribution.app','mode':'managed','change':{'actions':['create'],'after':cf}}], 'planned_values':{'root_module':{'resources':[{'address':'data.aws_cloudfront_cache_policy.caching_disabled','values':{'name':'Managed-CachingDisabled','id':'cache-id'}},{'address':'data.aws_cloudfront_origin_request_policy.all_viewer_except_host','values':{'name':'Managed-AllViewerExceptHostHeader','id':'request-id'}}]}}}
        self.assertEqual(guard.validate(plan,'alb.example.amazonaws.com'),[])
        for key,value in [('aliases',['seaandshore.in']),('web_acl_id','wrong-acl'),('origin',[{'domain_name':'wrong-origin'}]),('enabled',False)]:
            bad=copy.deepcopy(plan)
            bad['resource_changes'][1]['change']['after'][key]=value
            self.assertTrue(guard.validate(bad,'alb.example.amazonaws.com'))

if __name__ == '__main__': unittest.main()
