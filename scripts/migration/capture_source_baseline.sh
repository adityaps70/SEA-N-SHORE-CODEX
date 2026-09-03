#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL in your local shell; never commit it.}"

mkdir -p artifacts/migration
umask 077

psql "$SOURCE_DATABASE_URL" -X -f scripts/migration/supabase_inventory.sql \
  > artifacts/migration/source-inventory.txt
psql "$SOURCE_DATABASE_URL" -X -f scripts/migration/supabase_integrity.sql \
  > artifacts/migration/source-integrity.txt

sha256sum artifacts/migration/source-inventory.txt \
  artifacts/migration/source-integrity.txt \
  > artifacts/migration/SHA256SUMS

printf 'Baseline written under artifacts/migration/ (gitignored).\n'
