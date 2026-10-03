# Sea N Shore edge recovery — 7 September 2026

Scope: `adityaps70/SEA-N-SHORE-CODEX`, branch `feat/aws-native-phase-0-1` only.

## Verified classification

Read-only audit 34114609941 at commit 410760371a64762f96331abfce8b3383b4a1e836 read S3 state serial 12, lineage 197a6fae-9997-636e-e52b-c3ac6da85d90, object version VAAHudmgS6y8YWliCevgLd6UEWERnBaP.

The state tracked one live resource: `aws_wafv2_web_acl.edge`, ID `3d249028-c2ca-4c2e-bcc4-1ef31ad2acc0`, scope CLOUDFRONT, us-east-1. Its matching provider alias and configuration had been removed. Follow-up audit 34114966794 confirmed restoration and both missing-configuration flags false. Subsequent explicit non-paginated inventory confirmed zero CloudFront distributions before creation.

## Repair and controls

- Restored the existing WAF resource and `aws.us_east_1` provider; retained both AWS-managed common rules and the 2,000 requests/300 seconds per-IP rate rule.
- No state removal/import, WAF deletion or recreation.
- Replaced deleted-worktree assumptions with temporary clones pinned to the triggering commit.
- Audits require exact-commit green infrastructure CI before AWS authentication.
- Read state with S3 GetObject, keeping raw state private and logging only selected edge evidence.
- Bootstrap `/tmp` is a 457 MB tmpfs; the 889 MB provider cannot be installed there. Recovery reuses the existing lockfile-verified provider without modifying its checkout.
- Targeted Terraform plan contains only CloudFront create and WAF no-op. The guard checks resource actions, existing ACL identity, origin, HTTPS redirect, managed caching-disabled policy, absence of custom domains, and unknown safety fields.
- Reviewed apply path uses the exact freshly checked saved plan, state locking, bucket versioning evidence, and private recovery-file preservation on failure.

## Validation before apply

Commit d554a2fd0ab066f28604d0e05399cf45d7fd61cf: CI 34116490287 all six jobs green; remote plan 34116490388 green; state serial still 12. Guard and existing execution-contract tests passed locally; independent review found no remaining material blocker after recovery-file preservation fix.

## Applied and independently verified

Commit dbc12d74a3cf3af7040bc2810dc13205ca42f150 passed exact-head CI 34116797402. Recovery run 34116797782 succeeded after checking and applying the saved plan (SHA256 62ba1205c8d1b41ef3619b0f77b7798ffe9e5563b642db18c6e24b7a6ea5f9ad).

- Distribution: EF1K45UVP11XZ, status Deployed.
- HTTPS: https://d3prih0q6jofyr.cloudfront.net
- Existing WAF attached; no custom domain aliases.
- State serial advanced from 12 to 13; pre-apply S3 version recorded above remains rollback evidence.
- `/api/health/phase4` and `/api/health/home`: HTTP 200, every health field true, `Cache-Control: private, no-store`, CloudFront cache misses.
- HTTP health request redirects with 301 to HTTPS.
- Homepage returns 200 over trusted HTTPS.
- Harmless XSS-signature query against the read-only health route is blocked with 403 by the WAF path.
- ECS task definition unchanged during apply; desired/running/pending 1/1/0, rollout completed, failed tasks zero.

Independent HTTPS/homepage/WAF checks were repeated from the desktop after the AWS recovery job succeeded. The repository recovery action is returned to `plan`; repeated creation is also refused when state already tracks the distribution.

Source verification: [apply and live checks](https://github.com/adityaps70/SEA-N-SHORE-CODEX/actions/runs/34116797782), [apply-commit CI](https://github.com/adityaps70/SEA-N-SHORE-CODEX/actions/runs/34116797402), [reviewed plan](https://github.com/adityaps70/SEA-N-SHORE-CODEX/actions/runs/34116490388).

## Boundaries

No production DNS/nameserver changes, Cognito SES switch, full app apply, Vercel shutdown, Supabase decommission, main-branch changes, PR, or branch merge. SES Phase 5B remains paused. CloudFront provides the AWS-managed HTTPS hostname; the existing ALB origin connection remains HTTP pending a separately scoped origin-certificate setup. Application canonical URL/auth configuration is unchanged by this recovery.
