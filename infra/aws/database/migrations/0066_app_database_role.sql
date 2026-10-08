-- Round 14 (2.12): least-privilege role for the web task and the workers. DML only: no DDL, no
-- TRUNCATE, no ownership. It starts NOLOGIN; the secret rotation Lambda sets its password and LOGIN.
do $$ begin if not exists (select 1 from pg_roles where rolname = 'sea_n_shore_app') then create role sea_n_shore_app nologin; end if; end $$;
-- statement-breakpoint
grant connect on database sea_n_shore to sea_n_shore_app;
-- statement-breakpoint
grant usage on schema public, private to sea_n_shore_app;
-- statement-breakpoint
grant select, insert, update, delete on all tables in schema public to sea_n_shore_app;
-- statement-breakpoint
grant usage, select, update on all sequences in schema public to sea_n_shore_app;
-- statement-breakpoint
grant execute on all functions in schema public, private to sea_n_shore_app;
-- statement-breakpoint
alter default privileges for role sns_cluster_admin in schema public grant select, insert, update, delete on tables to sea_n_shore_app;
-- statement-breakpoint
alter default privileges for role sns_cluster_admin in schema public grant usage, select, update on sequences to sea_n_shore_app;
-- statement-breakpoint
alter default privileges for role sns_cluster_admin in schema public, private grant execute on functions to sea_n_shore_app;
