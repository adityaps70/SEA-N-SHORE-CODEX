# Sea N Shore AWS Staging Migration Runbook

## Objective

Move the current Sea N Shore Next.js application from Vercel to AWS for staging and product verification while leaving Supabase unchanged. This is deliberately a hosting-only migration: PostgreSQL, Supabase Auth, RLS, RPCs, Storage, feed data, and My Network data stay exactly where they are.

The AWS resources created here are not throwaway infrastructure. ECR, ECS/Fargate, the ALB, CloudWatch, IAM/OIDC, and the VPC remain useful as the platform scales. CloudFront, WAF, private ECS subnets, S3 application storage, SES, SQS, EventBridge, Aurora PostgreSQL, and Cognito are added in later phases after the staging application is proven.

## Safety rules

- Do not change Supabase database/auth during this migration.
- Do not point the production domain at AWS until staging passes the full smoke test.
- Keep the current Vercel production deployment available as rollback until AWS production is verified.
- Never put AWS access keys or Supabase service-role keys in GitHub. GitHub uses AWS OIDC and the app currently requires only public Supabase browser configuration.
- Use `ap-south-1` (Mumbai) for the first deployment unless there is an explicit reason to change it.

## Repository layout

- `Dockerfile` — production Next.js 16 / Node 22 image.
- `infra/aws/bootstrap/main.tf` — one-time AWS bootstrap: Terraform state bucket, ECR, GitHub OIDC deploy role, optional monthly budget alerts.
- `infra/aws/app/main.tf` — VPC, public ALB, ECS/Fargate service, task roles, CloudWatch logs, target group, and autoscaling.
- `.github/workflows/aws-infra-ci.yml` — Terraform validation plus Docker build verification.
- `.github/workflows/aws-staging-deploy.yml` — OIDC-authenticated build/push and ECS deployment.

## Stage 1 — AWS account preparation

1. Use the AWS paid account mode so credits can offset eligible usage while all required services remain available.
2. Select Mumbai (`ap-south-1`).
3. Enable MFA on the root account and use an administrative IAM/Identity Center session for infrastructure work.
4. Open Billing and Cost Management and make sure billing alerts are enabled.
5. Do not create long-lived AWS access keys for GitHub.

## Stage 2 — Run the bootstrap stack

Use a trusted workstation or AWS CloudShell with Terraform 1.9+.

```bash
git clone https://github.com/adityaps70/SEA-N-SHORE-CODEX.git
cd SEA-N-SHORE-CODEX
git checkout infra/aws-migration
cd infra/aws/bootstrap
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and set the billing email. If the AWS account already has the GitHub Actions OIDC provider, set `existing_github_oidc_provider_arn` to that ARN instead of creating a second provider.

Then run:

```bash
terraform init
terraform fmt -check
terraform validate
terraform plan
terraform apply
```

Record these outputs:

- `terraform_state_bucket`
- `ecr_repository_name`
- `ecr_repository_url`
- `github_deploy_role_arn`

The bootstrap does not create ECS yet.

## Stage 3 — Configure GitHub Environment `staging`

In GitHub repository settings create/use the Environment named `staging`.

Add environment variables:

- `AWS_REGION` = `ap-south-1`
- `AWS_ROLE_TO_ASSUME` = bootstrap output `github_deploy_role_arn`
- `ECR_REPOSITORY` = bootstrap output `ecr_repository_name`
- `NEXT_PUBLIC_SITE_URL` = `https://staging.invalid` for the first image only
- `NEXT_PUBLIC_SUPABASE_URL` = current Supabase project URL

Add environment secret:

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = current Supabase publishable key

The publishable key is browser configuration, not a privileged service-role key, but storing it as a GitHub Environment secret keeps logs and settings tidy.

## Stage 4 — Push the first image to ECR

Run the GitHub Actions workflow `AWS Staging Deploy` manually with `deploy_to_ecs = false`.

This authenticates to AWS through OIDC, builds the current Next.js application as a Docker image, and pushes an immutable image tag to ECR. The workflow summary prints the image tag.

Record that tag.

## Stage 5 — Create the AWS application stack

```bash
cd infra/aws/app
cp terraform.tfvars.example terraform.tfvars
```

Set:

- `image_tag` to the ECR tag from Stage 4.
- `site_url` to `https://staging.invalid` for this bootstrap revision.
- `supabase_url` to the current Supabase URL.
- `supabase_publishable_key` to the current publishable key.
- `certificate_arn` blank for the first HTTP-only ALB smoke deployment.

Initialize remote state using the bootstrap state bucket:

```bash
terraform init \
  -backend-config="bucket=REPLACE_WITH_STATE_BUCKET" \
  -backend-config="key=sea-n-shore/staging/terraform.tfstate" \
  -backend-config="region=ap-south-1" \
  -backend-config="use_lockfile=true"

terraform fmt -check
terraform validate
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

Record the outputs:

- `alb_dns_name`
- `alb_http_url`
- `ecs_cluster_name`
- `ecs_service_name`
- `ecs_task_definition_family`
- `ecs_container_name`
- `cloudwatch_log_group`

The initial architecture uses Fargate tasks in locked-down public subnets so the staging stack does not need a NAT Gateway. The tasks have public IPs only for outbound internet access, but their security group accepts port 3000 exclusively from the ALB security group. At larger scale, the same ECS service can move to private subnets with VPC endpoints/NAT without changing the application contract.

## Stage 6 — Rebuild with the real AWS staging URL

Update the GitHub `staging` environment variable:

- `NEXT_PUBLIC_SITE_URL` = the Terraform output `alb_http_url`

Add these GitHub environment variables from Terraform outputs:

- `ECS_CLUSTER`
- `ECS_SERVICE`
- `ECS_TASK_DEFINITION`
- `ECS_CONTAINER_NAME`

Run `AWS Staging Deploy` again with `deploy_to_ecs = true`.

The workflow builds a new image with the correct site URL, registers a new ECS task definition revision, updates the ECS service, and waits for the service to become stable.

## Stage 7 — Supabase Auth staging redirect

Do not replace the existing production Site URL yet. In Supabase Auth URL configuration, add the AWS staging callback to the allowed redirect list:

```text
http://YOUR_ALB_DNS/auth/callback
```

When an HTTPS staging domain is introduced, add the HTTPS callback and remove the temporary HTTP callback after validation.

No database migrations are required for this step.

## Stage 8 — Required AWS smoke test

Before any production cutover, verify on the AWS staging URL:

1. Signed-out route protection and sign-in page.
2. Email/password sign-in and session persistence.
3. Auth callback behavior.
4. Onboarding for a controlled test account.
5. Home feed load, composer, reactions/comments where applicable.
6. Public and authenticated professional profiles.
7. My Network: Discover, Connections, Received Requests, Sent Requests, Following.
8. Follow/unfollow independent from connections.
9. Connection request, cancel, accept, decline, remove.
10. Notifications Bell, unread count, individual read, mark all read, `/notifications`.
11. Block/unblock: pair disappears while blocked and no relationship is restored on unblock.
12. People You May Know and relationship-aware Home prioritization.
13. Desktop and mobile navigation.
14. CloudWatch logs contain no repeating runtime exceptions.
15. ECS service stays healthy through at least one fresh deployment.

## Stage 9 — HTTPS staging domain

After the ALB smoke test passes:

1. Choose a staging hostname such as `staging.seaandshore.in`.
2. Request an ACM certificate in `ap-south-1`.
3. Complete DNS validation.
4. Put the ACM certificate ARN into `certificate_arn` and apply Terraform again.
5. Point the staging hostname to the ALB using the DNS provider.
6. Change `NEXT_PUBLIC_SITE_URL` and `site_url` to the final HTTPS staging URL.
7. Add the HTTPS `/auth/callback` URL in Supabase Auth.
8. Run `AWS Staging Deploy` again with `deploy_to_ecs = true`.
9. Repeat the full smoke test over HTTPS.

## Stage 10 — Production cutover (only after approval)

Do not reuse staging state for production. Create a separate production Terraform state key and production configuration. Start with at least two Fargate tasks for high availability, enable HTTPS, add CloudFront/WAF, use deletion protection where appropriate, and establish alarms before DNS cutover.

Production cutover order:

1. Deploy the exact tested image to AWS production.
2. Test production through a temporary hostname.
3. Add production AWS callback URLs to Supabase Auth.
4. Lower DNS TTL before cutover.
5. Point the production domain to AWS.
6. Run the production smoke suite.
7. Watch CloudWatch/ALB/ECS/Supabase logs.
8. Keep Vercel available as rollback until the observation window passes.

## Rollback

If AWS staging fails, no rollback of user data is required because Supabase remains the source of truth. Fix or destroy the staging AWS app stack without touching Supabase.

If a later production cutover fails, point DNS back to the previously verified Vercel deployment while leaving Supabase untouched. This is why the hosting migration is completed before any Supabase-to-AWS migration begins.

## Later AWS phases

After AWS hosting is stable:

- CloudFront + WAF in front of the ALB.
- Private ECS task subnets/VPC endpoints as traffic and security requirements justify them.
- S3/CloudFront for large media and documents.
- SES for transactional mail.
- SQS + ECS workers/Lambda for background work.
- EventBridge for schedules.
- Aurora PostgreSQL migration from Supabase PostgreSQL.
- Cognito migration only after database/auth abstraction and RLS replacement are ready.

Supabase Auth should be one of the last Supabase dependencies removed because the current authorization model deliberately relies on Supabase Auth identity and PostgreSQL RLS.
