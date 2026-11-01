# CloudWatch Logs IAM validator (vendored)

`simulate_cloudwatch_logs_policy.py` is copied unmodified from AWS's
[aws-samples/sample-cloudwatch-logs-iam-policy-validator](https://github.com/aws-samples/sample-cloudwatch-logs-iam-policy-validator)
(`main`, fetched 2026-11-01), under the MIT-0 licence in `LICENSE-MIT-0`. Its SHA-256 is pinned in
`scripts/aws/cwl-iam-scan.test.mjs`, so any change to it fails the contract test.

It simulates a policy against every `logs:` action for the old log-stream ARN form and the standard
log-group ARN form (`aws iam simulate-custom-policy`, read-only). `scripts/aws/cwl-iam-scan.py` runs it
for the bootstrap host role's policies before the 26 April 2027 enforcement.
