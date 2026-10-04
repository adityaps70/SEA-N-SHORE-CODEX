#!/usr/bin/env bash
# Round 14 (3.6) guarded migration 0067: the stored, lower-cased profiles.search_text for people
# search, the functions and triggers on profiles, maritime_profiles and profile_skills that keep it
# current, a one-statement backfill and a GIN trigram index. Additive only: exactly the reviewed
# statements run, nothing else. The action file holds "plan" or "migrate-once".
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
MIGRATION="infra/aws/database/migrations/0067_people_search_text.sql"
ACTION_FILE="scripts/aws/people-search-text-migration-action.txt"

[[ "${PEOPLE_SEARCH_TEXT_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "PEOPLE_SEARCH_TEXT_EXPECTED_SHA must be exact." >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$PEOPLE_SEARCH_TEXT_EXPECTED_SHA" ]]
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
  "alter table public.profiles add column if not exists search_text text;",
  "create or replace function public.profile_search_text(profile public.profiles) returns text language sql stable set search_path = pg_catalog, public as $$ select lower(concat_ws(' ', profile.full_name, profile.slug, profile.location, profile.headline, profile.summary, profile.primary_identity, profile.primary_identity_family, profile.persona, array_to_string(profile.profile_intents, ' '), profile.community_relationship, profile.institution_name, profile.specialization, profile.role_other_text, profile.occupation_text, array_to_string(profile.secondary_identities, ' '), mp.rank, mp.current_company, mp.current_vessel, array_to_string(mp.vessel_types, ' '), array_to_string(mp.trading_areas, ' '), coalesce(( select string_agg(ps.skill, ' ' order by ps.skill) from public.profile_skills ps where ps.user_id = profile.id ), '') )) from (select 1) as one left join public.maritime_profiles mp on mp.user_id = profile.id $$;",
  "create or replace function public.profiles_set_search_text() returns trigger language plpgsql set search_path = pg_catalog, public as $$ begin new.search_text := public.profile_search_text(new); return new; end; $$;",
  "create or replace trigger profiles_set_search_text before insert or update on public.profiles for each row execute function public.profiles_set_search_text();",
  "create or replace function public.refresh_profile_search_text() returns trigger language plpgsql set search_path = pg_catalog, public as $$ begin if tg_op = 'INSERT' then update public.profiles p set search_text = public.profile_search_text(p) where p.id in (select changed.user_id from new_rows changed) and p.search_text is distinct from public.profile_search_text(p); elsif tg_op = 'DELETE' then update public.profiles p set search_text = public.profile_search_text(p) where p.id in (select changed.user_id from old_rows changed) and p.search_text is distinct from public.profile_search_text(p); else update public.profiles p set search_text = public.profile_search_text(p) where p.id in ( select changed.user_id from new_rows changed union select changed.user_id from old_rows changed ) and p.search_text is distinct from public.profile_search_text(p); end if; return null; end; $$;",
  "create or replace trigger maritime_profiles_search_text_insert after insert on public.maritime_profiles referencing new table as new_rows for each statement execute function public.refresh_profile_search_text();",
  "create or replace trigger maritime_profiles_search_text_update after update on public.maritime_profiles referencing old table as old_rows new table as new_rows for each statement execute function public.refresh_profile_search_text();",
  "create or replace trigger maritime_profiles_search_text_delete after delete on public.maritime_profiles referencing old table as old_rows for each statement execute function public.refresh_profile_search_text();",
  "create or replace trigger profile_skills_search_text_insert after insert on public.profile_skills referencing new table as new_rows for each statement execute function public.refresh_profile_search_text();",
  "create or replace trigger profile_skills_search_text_update after update on public.profile_skills referencing old table as old_rows new table as new_rows for each statement execute function public.refresh_profile_search_text();",
  "create or replace trigger profile_skills_search_text_delete after delete on public.profile_skills referencing old table as old_rows for each statement execute function public.refresh_profile_search_text();",
  "update public.profiles p set search_text = public.profile_search_text(p) where p.search_text is distinct from public.profile_search_text(p);",
  "create index if not exists profiles_search_text_trgm_idx on public.profiles using gin (search_text gin_trgm_ops);",
]
if [norm(p) for p in parts]!=expected: raise SystemExit('migration 0067 differs from the reviewed statements')
if any(re.search(r'security\s+definer',norm(p),re.I) for p in parts): raise SystemExit('SECURITY DEFINER is forbidden')
print('PEOPLE_SEARCH_TEXT_SQL_GUARD=EXACT_REVIEWED_STATEMENTS')
PY

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")" == "available" ]]
[[ "$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")" == "true" ]]

data_api(){ aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" "$@"; }
count(){ data_api --sql "$1" --output json | jq -r '.records[0][0].longValue'; }

SOURCE_TABLES_SQL="SELECT count(*)::bigint FROM pg_tables WHERE schemaname='public' AND tablename IN ('profiles','maritime_profiles','profile_skills')"
TRGM_SQL="SELECT count(*)::bigint FROM pg_extension WHERE extname='pg_trgm'"
COLUMN_SQL="SELECT count(*)::bigint FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='search_text' AND data_type='text'"
FUNCTIONS_SQL="SELECT count(*)::bigint FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace WHERE n.nspname='public' AND f.proname IN ('profile_search_text','profiles_set_search_text','refresh_profile_search_text') AND NOT f.prosecdef"
TRIGGERS_SQL="SELECT count(*)::bigint FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled <> 'D' AND (c.relname::text, t.tgname::text) IN (('profiles','profiles_set_search_text'),('maritime_profiles','maritime_profiles_search_text_insert'),('maritime_profiles','maritime_profiles_search_text_update'),('maritime_profiles','maritime_profiles_search_text_delete'),('profile_skills','profile_skills_search_text_insert'),('profile_skills','profile_skills_search_text_update'),('profile_skills','profile_skills_search_text_delete'))"
INDEX_SQL="SELECT count(*)::bigint FROM pg_indexes WHERE schemaname='public' AND tablename='profiles' AND indexname='profiles_search_text_trgm_idx' AND indexdef LIKE '%USING gin (search_text gin_trgm_ops)%'"
ACTIVE_SQL="SELECT count(*)::bigint FROM public.profiles WHERE account_status='active'"
# Only valid once the column and public.profile_search_text() exist (see schema_applied).
UNPOPULATED_SQL="SELECT count(*)::bigint FROM public.profiles p WHERE p.account_status='active' AND (p.search_text IS NULL OR p.search_text IS DISTINCT FROM public.profile_search_text(p))"
schema_applied(){ [[ "$(count "$COLUMN_SQL")" == "1" && "$(count "$FUNCTIONS_SQL")" == "3" && "$(count "$TRIGGERS_SQL")" == "7" && "$(count "$INDEX_SQL")" == "1" ]]; }
report(){
  echo "PEOPLE_SEARCH_TEXT_$1_COLUMN=$(count "$COLUMN_SQL")"
  echo "PEOPLE_SEARCH_TEXT_$1_FUNCTIONS=$(count "$FUNCTIONS_SQL")"
  echo "PEOPLE_SEARCH_TEXT_$1_TRIGGERS=$(count "$TRIGGERS_SQL")"
  echo "PEOPLE_SEARCH_TEXT_$1_INDEX=$(count "$INDEX_SQL")"
  echo "PEOPLE_SEARCH_TEXT_$1_ACTIVE_PROFILES=$(count "$ACTIVE_SQL")"
  if schema_applied; then echo "PEOPLE_SEARCH_TEXT_$1_UNPOPULATED_ACTIVE_PROFILES=$(count "$UNPOPULATED_SQL")"; fi
}
applied(){ schema_applied && [[ "$(count "$UNPOPULATED_SQL")" == "0" ]]; }

if applied; then report AFTER; echo "PEOPLE_SEARCH_TEXT_ALREADY_APPLIED=true"; exit 0; fi
report BEFORE
[[ "$(count "$SOURCE_TABLES_SQL")" == "3" ]] || { echo "profiles, maritime_profiles or profile_skills is missing; refusing to apply." >&2; exit 1; }
[[ "$(count "$TRGM_SQL")" == "1" ]] || { echo "pg_trgm (migration 0063) is missing; refusing to apply." >&2; exit 1; }

echo "PEOPLE_SEARCH_TEXT_PLAN_VERIFIED=true"
[[ "$ACTION" == "migrate-once" ]] || { echo "PEOPLE_SEARCH_TEXT_PLAN_ONLY_NO_APPLY=true"; exit 0; }
[[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$PEOPLE_SEARCH_TEXT_EXPECTED_SHA" ]]

TX="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
committed=false
cleanup(){ if [[ "$committed" != true ]]; then aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
data_api --transaction-id "$TX" --sql "SELECT pg_advisory_xact_lock(hashtext('sea-n-shore-people-search-text-0067')::bigint)" >/dev/null
# ADD COLUMN and the triggers lock public.profiles (and the two child tables) until commit; never
# wait long behind live traffic, retry instead. The backfill and the index build take seconds.
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

applied || { echo "search_text column, functions, triggers, index or backfill missing after apply." >&2; exit 1; }
report AFTER
echo "PEOPLE_SEARCH_TEXT_APPLY_VERIFIED=true"
