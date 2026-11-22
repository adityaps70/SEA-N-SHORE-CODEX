-- Owner (18 Nov, ₹0): clear messages for the web servers' short-lived caches (own profile, identity, header counts,
-- session checks). Every change to the data those caches hold sends one NOTIFY on the channel sns_cache_clear with a
-- short tag, and each web server, listening on one connection, drops the matching entries at once. Postgres delivers a
-- NOTIFY only when its transaction commits (a rolled-back change sends nothing) and sends each distinct tag once per
-- transaction. A server whose listener is not connected does not cache at all (src/lib/cache/cache-clear.ts).
--
-- Tags (ids only, never names or content):
--   p:<profile id>      the member's own profile: profiles, maritime_profiles, profile_skills, account status
--   co:<company id>     a company shown on profiles
--   i:<cognito subject> an identity mapping (identity_accounts)
--   c:<profile id>      the member's header counts: notifications, messages, read state, connection requests
--   s:<origin hash>     a sign-in ended (revoked, token reuse) in auth_sessions
--
-- Additive and safe to run more than once (create or replace). No row is read or rewritten. Reversible: drop the
-- *_cache_clear triggers and the public.cache_clear_* functions.
-- statement-breakpoint
create or replace function public.cache_clear_profile() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform pg_notify('sns_cache_clear', 'p:' || old.id::text);
  else
    perform pg_notify('sns_cache_clear', 'p:' || new.id::text);
  end if;
  return null;
end;
$$;
-- statement-breakpoint
create or replace trigger profiles_cache_clear
  after update or delete on public.profiles
  for each row execute function public.cache_clear_profile();
-- statement-breakpoint
create or replace function public.cache_clear_profile_by_user_id() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform pg_notify('sns_cache_clear', 'p:' || old.user_id::text);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform pg_notify('sns_cache_clear', 'p:' || new.user_id::text);
  end if;
  return null;
end;
$$;
-- statement-breakpoint
create or replace trigger maritime_profiles_cache_clear
  after insert or update or delete on public.maritime_profiles
  for each row execute function public.cache_clear_profile_by_user_id();
-- statement-breakpoint
create or replace trigger profile_skills_cache_clear
  after insert or update or delete on public.profile_skills
  for each row execute function public.cache_clear_profile_by_user_id();
-- statement-breakpoint
create or replace function public.cache_clear_company() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform pg_notify('sns_cache_clear', 'co:' || old.id::text);
  else
    perform pg_notify('sns_cache_clear', 'co:' || new.id::text);
  end if;
  return null;
end;
$$;
-- statement-breakpoint
create or replace trigger companies_cache_clear
  after update or delete on public.companies
  for each row execute function public.cache_clear_company();
-- statement-breakpoint
create or replace function public.cache_clear_identity() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform pg_notify('sns_cache_clear', 'i:' || old.provider_subject);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform pg_notify('sns_cache_clear', 'i:' || new.provider_subject);
  end if;
  return null;
end;
$$;
-- statement-breakpoint
create or replace trigger identity_accounts_cache_clear
  after insert or update or delete on public.identity_accounts
  for each row execute function public.cache_clear_identity();
-- statement-breakpoint
create or replace function public.cache_clear_counts_recipient() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform pg_notify('sns_cache_clear', 'c:' || old.recipient_id::text);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform pg_notify('sns_cache_clear', 'c:' || new.recipient_id::text);
  end if;
  return null;
end;
$$;
-- statement-breakpoint
create or replace trigger notifications_cache_clear
  after insert or update or delete on public.notifications
  for each row execute function public.cache_clear_counts_recipient();
-- statement-breakpoint
create or replace function public.cache_clear_counts_participant() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform pg_notify('sns_cache_clear', 'c:' || old.profile_id::text);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform pg_notify('sns_cache_clear', 'c:' || new.profile_id::text);
  end if;
  return null;
end;
$$;
-- statement-breakpoint
create or replace trigger conversation_participants_cache_clear
  after insert or update or delete on public.conversation_participants
  for each row execute function public.cache_clear_counts_participant();
-- statement-breakpoint
-- A new, edited or deleted message changes the unread count of everyone in its conversation.
create or replace function public.cache_clear_counts_conversation() returns trigger language plpgsql as $$
declare
  conversation uuid := case when tg_op = 'DELETE' then old.conversation_id else new.conversation_id end;
begin
  perform pg_notify('sns_cache_clear', 'c:' || cp.profile_id::text)
  from public.conversation_participants cp
  where cp.conversation_id = conversation;
  return null;
end;
$$;
-- statement-breakpoint
create or replace trigger messages_cache_clear
  after insert or update or delete on public.messages
  for each row execute function public.cache_clear_counts_conversation();
-- statement-breakpoint
create or replace function public.cache_clear_counts_connection() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform pg_notify('sns_cache_clear', 'c:' || old.user_low_id::text);
    perform pg_notify('sns_cache_clear', 'c:' || old.user_high_id::text);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform pg_notify('sns_cache_clear', 'c:' || new.user_low_id::text);
    perform pg_notify('sns_cache_clear', 'c:' || new.user_high_id::text);
  end if;
  return null;
end;
$$;
-- statement-breakpoint
create or replace trigger connections_cache_clear
  after insert or update or delete on public.connections
  for each row execute function public.cache_clear_counts_connection();
-- statement-breakpoint
-- Only the changes that end a sign-in (not the last-seen touch, which runs at most every 5 minutes per sign-in).
create or replace function public.cache_clear_session() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform pg_notify('sns_cache_clear', 's:' || old.token_origin_hash);
  elsif old.revoked_at is distinct from new.revoked_at
     or old.reuse_detected_at is distinct from new.reuse_detected_at
     or old.profile_id is distinct from new.profile_id then
    perform pg_notify('sns_cache_clear', 's:' || new.token_origin_hash);
  end if;
  return null;
end;
$$;
-- statement-breakpoint
create or replace trigger auth_sessions_cache_clear
  after update or delete on public.auth_sessions
  for each row execute function public.cache_clear_session();
