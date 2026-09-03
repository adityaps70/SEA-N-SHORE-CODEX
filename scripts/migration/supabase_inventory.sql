\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

SELECT 'table' AS object_type, table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('public', 'auth', 'storage')
  AND table_type = 'BASE TABLE'
ORDER BY table_schema, table_name;

SELECT 'column' AS object_type,
       table_schema,
       table_name,
       ordinal_position,
       column_name,
       data_type,
       is_nullable,
       column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

SELECT 'constraint' AS object_type,
       n.nspname AS schema_name,
       c.relname AS table_name,
       con.conname AS constraint_name,
       pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname, con.conname;

SELECT 'index' AS object_type, schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

SELECT 'policy' AS object_type,
       schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual,
       with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

SELECT 'function' AS object_type,
       n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private')
ORDER BY n.nspname, p.proname, arguments;

SELECT 'trigger' AS object_type,
       n.nspname AS schema_name,
       c.relname AS table_name,
       t.tgname AS trigger_name,
       pg_get_triggerdef(t.oid, true) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

SELECT 'storage_bucket' AS object_type, id, name, public
FROM storage.buckets
ORDER BY id;

SELECT 'storage_object_count' AS object_type, bucket_id, count(*) AS object_count
FROM storage.objects
GROUP BY bucket_id
ORDER BY bucket_id;

SELECT 'auth_user_summary' AS object_type,
       count(*) AS user_count,
       md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) AS user_uuid_digest
FROM auth.users;

COMMIT;
