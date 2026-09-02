create index audit_events_actor_idx on public.audit_events(actor_id);
create index companies_created_by_idx on public.companies(created_by);
create index user_roles_granted_by_idx on public.user_roles(granted_by);
