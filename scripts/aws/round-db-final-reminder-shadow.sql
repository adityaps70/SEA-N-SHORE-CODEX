-- Round DB (Deploy B): the live shadow comparison of the final-reminder exclusion rule, previous (frozen) against
-- current. Generated from src/features/legacy-invites/final-reminder-previous-sql.fixture.ts; do not edit by hand
-- (final-reminder-shadow-sql.test.ts fails if it drifts). Read-only; prints reason names and counts only.
select previous.reason as previous_reason, current_rule.reason as current_reason, count(*)::int as n
from (
  select invite.id, case
      when invite.status <> 'sent' or invite.sent_at is null then 'first_not_sent'
      when reminder.id is null or reminder.status <> 'sent' or reminder.sent_at is null then 'reminder_not_sent'
      when exists (
        select 1 from public.legacy_profile_invite_final_reminders final
        where (final.invite_id = invite.id or final.reminder_id = reminder.id or lower(final.email) = lower(invite.email))
          and not (final.status = 'cancelled' and final.attempts = 0)
      ) then 'already_final'
      when reminder.sent_at > now() - interval '14 days' then 'too_recent'
      when exists (
        select 1 from public.email_suppressions suppression
        where suppression.email = lower(invite.email) and suppression.reason <> 'unsubscribed'
      ) or exists (
        select 1 from public.email_delivery_events event
        where event.resend_email_id in (invite.resend_message_id, reminder.resend_message_id)
          and event.event_type in ('bounced', 'complained', 'suppressed')
      ) then 'bounced_or_suppressed'
      when (
        invite.delivered_at is null and not exists (
          select 1 from public.email_delivery_events event
          where event.resend_email_id = invite.resend_message_id and event.event_type in ('delivered', 'opened', 'clicked')
        )
      ) or not exists (
        select 1 from public.email_delivery_events event
        where event.resend_email_id = reminder.resend_message_id and event.event_type in ('delivered', 'opened', 'clicked')
      ) then 'not_delivered'
      when exists (
        select 1 from public.legacy_profile_claims claim
        where claim.profile_id = invite.profile_id and claim.claimed_at is not null
      ) or exists (
        select 1 from public.legacy_profile_claims claim
        where lower(claim.email) = lower(invite.email) and claim.claimed_at is not null
      ) then 'claimed'
      when exists (
        select 1 from public.identity_accounts identity
        where lower(identity.email) = lower(invite.email)
      ) then 'has_account'
      when exists (
        select 1 from public.email_suppressions suppression
        where suppression.email = lower(invite.email) and suppression.reason = 'unsubscribed'
      ) or exists (
        select 1 from public.newsletter_subscribers subscriber
        where subscriber.email = lower(invite.email) and subscriber.status = 'unsubscribed'
      ) then 'opted_out'
      when (
        select count(distinct claim.profile_id) from public.legacy_profile_claims claim
        where lower(claim.email) = lower(invite.email)
      ) > 1 then 'duplicate_email'
      else 'eligible'
    end as reason
    from public.legacy_profile_invites invite
    left join public.legacy_profile_invite_reminders reminder on reminder.invite_id = invite.id
) previous
join (
  select invite.id, case
      when invite.status <> 'sent' or invite.sent_at is null then 'first_not_sent'
      when reminder.id is null or reminder.status <> 'sent' or reminder.sent_at is null then 'reminder_not_sent'
      when exists (
        select 1 from public.legacy_profile_invite_final_reminders final
        where final.invite_id = invite.id and not (final.status = 'cancelled' and final.attempts = 0)
      ) or exists (
        select 1 from public.legacy_profile_invite_final_reminders final
        where final.reminder_id = reminder.id and not (final.status = 'cancelled' and final.attempts = 0)
      ) or exists (
        select 1 from public.legacy_profile_invite_final_reminders final
        where lower(final.email) = lower(invite.email) and not (final.status = 'cancelled' and final.attempts = 0)
      ) then 'already_final'
      when reminder.sent_at > now() - interval '14 days' then 'too_recent'
      when exists (
        select 1 from public.email_suppressions suppression
        where suppression.email = lower(invite.email) and suppression.reason <> 'unsubscribed'
      ) or exists (
        select 1 from public.email_delivery_events event
        where event.resend_email_id in (invite.resend_message_id, reminder.resend_message_id)
          and event.event_type in ('bounced', 'complained', 'suppressed')
      ) then 'bounced_or_suppressed'
      when (
        invite.delivered_at is null and not exists (
          select 1 from public.email_delivery_events event
          where event.resend_email_id = invite.resend_message_id and event.event_type in ('delivered', 'opened', 'clicked')
        )
      ) or not exists (
        select 1 from public.email_delivery_events event
        where event.resend_email_id = reminder.resend_message_id and event.event_type in ('delivered', 'opened', 'clicked')
      ) then 'not_delivered'
      when exists (
        select 1 from public.legacy_profile_claims claim
        where claim.profile_id = invite.profile_id and claim.claimed_at is not null
      ) or exists (
        select 1 from public.legacy_profile_claims claim
        where lower(claim.email) = lower(invite.email) and claim.claimed_at is not null
      ) then 'claimed'
      when exists (
        select 1 from public.identity_accounts identity
        where lower(identity.email) = lower(invite.email)
      ) then 'has_account'
      when exists (
        select 1 from public.email_suppressions suppression
        where suppression.email = lower(invite.email) and suppression.reason = 'unsubscribed'
      ) or exists (
        select 1 from public.newsletter_subscribers subscriber
        where subscriber.email = lower(invite.email) and subscriber.status = 'unsubscribed'
      ) then 'opted_out'
      when (
        select count(distinct claim.profile_id) from public.legacy_profile_claims claim
        where lower(claim.email) = lower(invite.email)
      ) > 1 then 'duplicate_email'
      else 'eligible'
    end as reason
    from public.legacy_profile_invites invite
    left join public.legacy_profile_invite_reminders reminder on reminder.invite_id = invite.id
) current_rule using (id)
group by 1, 2
order by 1, 2
