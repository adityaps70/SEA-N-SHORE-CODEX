begin;

create extension if not exists pgtap with schema extensions;
select plan(1);

select ok(
  exists (
    select 1
    from pg_index i
    join pg_class table_class on table_class.oid = i.indrelid
    join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
    where table_namespace.nspname = 'public'
      and table_class.relname = 'notifications'
      and pg_get_indexdef(i.indexrelid) like '%(actor_id%'
  ),
  'notifications actor foreign key has a covering index'
);

select * from finish();
rollback;
