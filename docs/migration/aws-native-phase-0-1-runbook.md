# AWS-Native Phase 0 + Phase 1 Runbook

## Safety
Supabase remains live and writable. Phase 0/1 never deletes or changes Supabase.

## Source baseline
In the operator terminal, set `SOURCE_DATABASE_URL` through an approved secret channel and run:

```bash
./scripts/migration/capture_source_baseline.sh
```

Known pre-plan sanity is approximately 7 profiles, 11 posts, 7 follows, 6 connections, and 10 notifications; the live query is authoritative.

## Terraform state
Use the existing state bucket `sea-n-shore-310356785722-ap-south-1-tfstate`, key `sea-n-shore/staging/terraform.tfstate`, region `ap-south-1`, with `use_lockfile=true`.

## Plan safety
Always run:

```bash
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json
```

Do not apply if the guard fails or if the human-readable plan replaces the existing VPC, ALB, ECS cluster/service, ECR repository, or IAM/OIDC bootstrap resources.

## Rollback
No application rollback is required during Phase 0/1 because the runtime remains Supabase-backed. Destroy only newly added Phase 1 resources after explicit approval.
