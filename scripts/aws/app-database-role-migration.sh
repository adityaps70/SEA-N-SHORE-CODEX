#!/usr/bin/env bash
# Round 14 (2.12) guarded migration 0066: the least-privilege sea_n_shore_app role (NOLOGIN until
# the secret rotation Lambda sets its password) with DML-only grants and default privileges for
# future objects. Exactly the reviewed statements run, nothing else. The action file holds "plan"
# or "migrate-once".
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0066_app_database_role.sql"
ACTION_FILE="scripts/aws/app-database-role-migration-action.txt"

[[ "${APP_DATABASE_ROLE_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "APP_DATABASE_ROLE_EXPECTED_SHA must be exact." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$APP_DATABASE_ROLE_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- "$MIGRATION" "$0" "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in plan|migrate-once) ;; *) echo "Unsupported action: $ACTION" >&2; exit 1 ;; esac

python3 - "$MIGRATION" <<'PY'
import re,sys
sql=open(sys.argv[1],encoding='utf-8').read().strip()
parts=[p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$',sql,flags=re.M) if p.strip()]
norm=lambda p: ' '.join('\n'.join(x for x in p.splitlines() if not x.lstrip().startswith('--')).split())
expected=[
  "do $$ begin if not exists (select 1 from pg_roles where rolname = 'sea_n_shore_app') then create role sea_n_shore_app nologin; end if; end $$;",
  "grant connect on database sea_n_shore to sea_n_shore_app;",
  "grant usage on schema public, private to sea_n_shore_app;",
  "grant select, insert, update, delete on all tables in schema public to sea_n_shore_app;",
  "grant usage, select, update on all sequences in schema public to sea_n_shore_app;",
  "grant execute on all functions in schema public, private to sea_n_shore_app;",
  "alter default privileges for role sns_cluster_admin in schema public grant select, insert, update, delete on tables to sea_n_shore_app;",
  "alter default privileges for role sns_cluster_admin in schema public grant usage, select, update on sequences to sea_n_shore_app;",
  "alter default privileges for role sns_cluster_admin in schema public, private grant execute on functions to sea_n_shore_app;",
]
if [norm(p) for p in parts]!=expected: raise SystemExit('migration 0066 differs from the reviewed statements')
print('APP_DATABASE_ROLE_SQL_GUARD=EXACT_REVIEWED_STATEMENTS')
PY

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]

data_api(){ aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"; }
count(){ data_api --sql "$1" --output json | jq -r '.records[0][0].longValue'; }

ROLE_SQL="SELECT count(*)::bigint FROM pg_roles WHERE rolname='sea_n_shore_app' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb"
GRANTED_SQL="SELECT count(*)::bigint FROM pg_tables t WHERE t.schemaname='public' AND has_table_privilege('sea_n_shore_app', format('%I.%I', t.schemaname, t.tablename), 'SELECT,INSERT,UPDATE,DELETE')"
TABLES_SQL="SELECT count(*)::bigint FROM pg_tables WHERE schemaname='public'"
TRUNCATE_SQL="SELECT count(*)::bigint FROM pg_tables t WHERE t.schemaname='public' AND has_table_privilege('sea_n_shore_app', format('%I.%I', t.schemaname, t.tablename), 'TRUNCATE')"
DEFAULTS_SQL="SELECT count(*)::bigint FROM pg_default_acl d JOIN pg_roles r ON r.oid = d.defaclrole WHERE r.rolname='sns_cluster_admin' AND array_to_string(d.defaclacl, ',') LIKE '%sea_n_shore_app=%'"
FOREIGN_OWNED_SQL="SELECT count(*)::bigint FROM pg_tables WHERE schemaname='public' AND tableowner <> 'sns_cluster_admin'"
role_exists(){ [[ "$(count "SELECT count(*)::bigint FROM pg_roles WHERE rolname='sea_n_shore_app'")" == "1" ]]; }
report(){
  echo "APP_DATABASE_ROLE_$1_ROLE=$(count "SELECT count(*)::bigint FROM pg_roles WHERE rolname='sea_n_shore_app'")"
  if role_exists; then
    echo "APP_DATABASE_ROLE_$1_TABLES_GRANTED=$(count "$GRANTED_SQL")/$(count "$TABLES_SQL")"
    echo "APP_DATABASE_ROLE_$1_TRUNCATE_GRANTED=$(count "$TRUNCATE_SQL")"
    echo "APP_DATABASE_ROLE_$1_DEFAULT_PRIVILEGES=$(count "$DEFAULTS_SQL")"
  fi
}
applied(){ role_exists && [[ "$(count "$ROLE_SQL")" == "1" && "$(count "$GRANTED_SQL")" == "$(count "$TABLES_SQL")" && "$(count "$TRUNCATE_SQL")" == "0" && "$(count "$DEFAULTS_SQL")" -ge "4" ]]; }

# Round 14 (2.12): read-only cutover readiness. The app role does not own the tables, so row-level
# security would apply to it (the master owner bypasses it), and anything it cannot read, write or
# execute in public/private would break the app after the switch. All counts must be 0. Privilege
# functions sit behind CASE: Postgres may evaluate them before the relkind filter, and
# has_sequence_privilege errors on non-sequences.
cutover_readiness(){
  local rls missing_tables missing_views missing_sequences missing_functions
  rls="$(count "SELECT count(*)::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p') AND c.relrowsecurity")"
  missing_tables="$(count "SELECT count(*)::bigint FROM pg_tables t WHERE t.schemaname IN ('public','private') AND NOT has_table_privilege('sea_n_shore_app', format('%I.%I', t.schemaname, t.tablename), 'SELECT,INSERT,UPDATE,DELETE')")"
  missing_views="$(count "SELECT count(*)::bigint FROM pg_views v WHERE v.schemaname IN ('public','private') AND NOT has_table_privilege('sea_n_shore_app', format('%I.%I', v.schemaname, v.viewname), 'SELECT')")"
  missing_sequences="$(count "SELECT count(*)::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind = 'S' AND CASE WHEN c.relkind = 'S' THEN NOT has_sequence_privilege('sea_n_shore_app', c.oid, 'USAGE') ELSE false END")"
  missing_functions="$(count "SELECT count(*)::bigint FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p') AND CASE WHEN p.prokind IN ('f','p') THEN NOT has_function_privilege('sea_n_shore_app', p.oid, 'EXECUTE') ELSE false END")"
  echo "APP_DATABASE_ROLE_CUTOVER_RLS_TABLES=$rls"
  echo "APP_DATABASE_ROLE_CUTOVER_MISSING_TABLE_DML=$missing_tables"
  echo "APP_DATABASE_ROLE_CUTOVER_MISSING_VIEW_SELECT=$missing_views"
  echo "APP_DATABASE_ROLE_CUTOVER_MISSING_SEQUENCE_USAGE=$missing_sequences"
  echo "APP_DATABASE_ROLE_CUTOVER_MISSING_FUNCTION_EXECUTE=$missing_functions"
  if [[ "$rls$missing_tables$missing_views$missing_sequences$missing_functions" == "00000" ]]; then
    echo "APP_DATABASE_ROLE_CUTOVER_READY=true"
  else
    echo "APP_DATABASE_ROLE_CUTOVER_READY=false"
  fi
}

if applied; then report AFTER; cutover_readiness; echo "APP_DATABASE_ROLE_ALREADY_APPLIED=true"; exit 0; fi
report BEFORE
# Grants and default privileges only cover objects the master user owns.
FOREIGN_OWNED="$(count "$FOREIGN_OWNED_SQL")"
echo "APP_DATABASE_ROLE_TABLES_NOT_OWNED_BY_MASTER=$FOREIGN_OWNED"
[[ "$FOREIGN_OWNED" == "0" ]] || { echo "Some public tables are not owned by the master user; refusing." >&2; exit 1; }

echo "APP_DATABASE_ROLE_PLAN_VERIFIED=true"
[[ "$ACTION" == "migrate-once" ]] || { echo "APP_DATABASE_ROLE_PLAN_ONLY_NO_APPLY=true"; exit 0; }
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$APP_DATABASE_ROLE_EXPECTED_SHA" ]]

TX="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
committed=false
cleanup(){ if [[ "$committed" != true ]]; then aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
data_api --transaction-id "$TX" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-app-database-role-0066')::bigint)" >/dev/null
# Grants take brief locks on each table; never wait long behind live traffic, retry instead.
data_api --transaction-id "$TX" --sql "SET LOCAL lock_timeout = '5s'" >/dev/null
while IFS= read -r encoded; do
  SQL="$(printf '%s' "$encoded" | base64 --decode)"
  data_api --transaction-id "$TX" --sql "$SQL" >/dev/null
done < <(python3 - "$MIGRATION" <<'PY'
import base64,re,sys
sql=open(sys.argv[1],encoding='utf-8').read().strip()
for p in [p.strip() for p in re.split(r'^\s*-- statement-breakpoint\s*$',sql,flags=re.M) if p.strip()]:
    print(base64.b64encode(p.encode()).decode())
PY
)
aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX" >/dev/null
committed=true

applied || { echo "sea_n_shore_app role or its grants missing after apply." >&2; exit 1; }
report AFTER
echo "APP_DATABASE_ROLE_APPLY_VERIFIED=true"
