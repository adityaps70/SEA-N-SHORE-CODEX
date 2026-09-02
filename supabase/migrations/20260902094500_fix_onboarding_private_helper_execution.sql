alter function public.complete_onboarding(
  public.profile_type,
  text,
  text,
  text,
  text,
  text,
  public.contact_visibility,
  text[],
  text,
  text,
  text,
  numeric,
  text[],
  text[],
  boolean,
  text
) security definer;

alter function public.complete_onboarding(
  public.profile_type,
  text,
  text,
  text,
  text,
  text,
  public.contact_visibility,
  text[],
  text,
  text,
  text,
  numeric,
  text[],
  text[],
  boolean,
  text
) owner to postgres;

revoke all on function private.finalize_onboarding()
from public, anon, authenticated, service_role;

revoke all on function public.complete_onboarding(
  public.profile_type,
  text,
  text,
  text,
  text,
  text,
  public.contact_visibility,
  text[],
  text,
  text,
  text,
  numeric,
  text[],
  text[],
  boolean,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.complete_onboarding(
  public.profile_type,
  text,
  text,
  text,
  text,
  text,
  public.contact_visibility,
  text[],
  text,
  text,
  text,
  numeric,
  text[],
  text[],
  boolean,
  text
) to authenticated;

revoke all on schema private from public, anon, authenticated;
