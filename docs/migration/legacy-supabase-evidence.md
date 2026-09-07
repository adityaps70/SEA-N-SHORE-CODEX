# Legacy Supabase Evidence Classification

The `supabase/` tree on `feat/aws-native-phase-0-1` is retained only as migration evidence and rollback/reference material. It is not part of the AWS application runtime path.

## Retained temporarily

- `supabase/migrations/**` — source schema/policy history used to verify Aurora parity and final migration mapping.
- `supabase/tests/**` — historical RLS and schema behavior evidence.
- `scripts/migration/supabase_inventory.sql` — read-only source inventory.
- `scripts/migration/supabase_integrity.sql` — read-only source integrity checks.
- `scripts/migration/capture_source_baseline.sh` — read-only baseline capture using `psql`.

## Prohibited in the AWS runtime

The AWS branch must not:

- import `@supabase/ssr` or `@supabase/supabase-js`;
- contain `src/lib/supabase` runtime helpers;
- expose `NEXT_PUBLIC_SUPABASE_*` build/runtime variables;
- require the Supabase CLI to build, test, deploy, or run the AWS application;
- use Supabase RPC/data/storage calls from `src/**`;
- depend on Vercel runtime APIs or Vercel-only environment variables.

These rules are enforced by `scripts/aws/check-phase4-supabase-runtime.sh` in AWS Infrastructure CI.

## Deletion criteria

Do not delete this legacy evidence until all of the following are true:

1. Production traffic has moved to AWS and remained healthy through the agreed observation window.
2. Final Supabase -> Aurora data delta has completed.
3. Source/target row counts, key reconciliation, duplicate/conflict checks, and referential-integrity checks pass.
4. Supabase Storage -> S3 reconciliation has no unresolved missing production objects.
5. Cognito identity mapping has been reconciled against production users.
6. Rollback/restore evidence has been captured and the rollback window has expired.
7. Production DNS and email-domain cutover have been verified.
8. A final backup/export of Supabase data and metadata exists before decommissioning.

Until then, Supabase remains a legacy production/source and rollback dependency, not an AWS application runtime dependency.
