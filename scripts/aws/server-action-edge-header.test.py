import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('check-edge-plan.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

CLOUDFRONT_HOST = 'd3prih0q6jofyr.cloudfront.net'
ORIGIN = 'sea-n-shore-staging-alb-68367905.ap-south-1.elb.amazonaws.com'


def cloudfront_after(custom_header):
    return {
        'web_acl_id': guard.WAF_ARN,
        'enabled': True,
        'aliases': [],
        'viewer_certificate': [{'cloudfront_default_certificate': True}],
        'origin': [{
            'domain_name': ORIGIN,
            'origin_id': 'sea-n-shore-staging-alb',
            'origin_path': '',
            'custom_header': custom_header,
            'custom_origin_config': [{
                'http_port': 80,
                'https_port': 443,
                'origin_protocol_policy': 'http-only',
                'origin_ssl_protocols': ['TLSv1.2'],
            }],
        }],
        'default_cache_behavior': [{
            'target_origin_id': 'sea-n-shore-staging-alb',
            'viewer_protocol_policy': 'redirect-to-https',
            'cache_policy_id': guard.CACHE_POLICY_ID,
            'origin_request_policy_id': guard.ORIGIN_POLICY_ID,
            'allowed_methods': ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
        }],
    }


def plan_for(custom_header, actions=None):
    return {
        'resource_changes': [
            {
                'address': 'aws_wafv2_web_acl.edge',
                'mode': 'managed',
                'change': {'actions': ['no-op'], 'after': {'id': guard.WAF_ID}},
            },
            {
                'address': 'aws_cloudfront_distribution.app',
                'mode': 'managed',
                'change': {'actions': actions or ['update'], 'after': cloudfront_after(custom_header)},
            },
        ],
        'planned_values': {
            'root_module': {
                'resources': [
                    {
                        'address': 'data.aws_cloudfront_cache_policy.caching_disabled',
                        'mode': 'data',
                        'values': {'name': 'Managed-CachingDisabled', 'id': guard.CACHE_POLICY_ID},
                    },
                    {
                        'address': 'data.aws_cloudfront_origin_request_policy.all_viewer_except_host',
                        'mode': 'data',
                        'values': {'name': 'Managed-AllViewerExceptHostHeader', 'id': guard.ORIGIN_POLICY_ID},
                    },
                ]
            }
        },
    }


class ServerActionEdgeHeaderTests(unittest.TestCase):
    def test_edge_tf_declares_exact_forwarded_host(self):
        edge = Path('infra/aws/app/edge.tf').read_text()
        self.assertIn('custom_header {', edge)
        self.assertIn('name  = "X-Forwarded-Host"', edge)
        self.assertIn(f'value = "{CLOUDFRONT_HOST}"', edge)
        self.assertIn('Managed-AllViewerExceptHostHeader', edge)

    def test_guard_accepts_only_exact_in_place_header_update(self):
        expected = [{'name': 'X-Forwarded-Host', 'value': CLOUDFRONT_HOST}]
        self.assertEqual(guard.validate(plan_for(expected), ORIGIN), [])

        for bad_header in [
            [],
            [{'name': 'X-Forwarded-Host', 'value': 'evil.example.com'}],
            [{'name': 'Host', 'value': CLOUDFRONT_HOST}],
            expected + [{'name': 'X-Test', 'value': 'extra'}],
        ]:
            self.assertTrue(guard.validate(plan_for(bad_header), ORIGIN))

        self.assertTrue(guard.validate(plan_for(expected, ['delete', 'create']), ORIGIN))


if __name__ == '__main__':
    unittest.main()
