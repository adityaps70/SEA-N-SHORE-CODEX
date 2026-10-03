\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

SELECT format(
  'SELECT %L AS table_name, count(*) AS row_count FROM public.%I;',
  table_name,
  table_name
)
FROM (VALUES
  ('audit_events'),
  ('companies'),
  ('company_members'),
  ('connections'),
  ('follows'),
  ('maritime_profiles'),
  ('notifications'),
  ('post_comments'),
  ('post_media'),
  ('post_poll_options'),
  ('post_poll_votes'),
  ('post_polls'),
  ('post_reactions'),
  ('posts'),
  ('profile_skills'),
  ('profiles'),
  ('saved_posts'),
  ('user_blocks'),
  ('user_roles')
) AS tables(table_name)
ORDER BY table_name
\gexec

SELECT 'profiles' AS relation,
       count(*) AS row_count,
       md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) AS key_digest
FROM public.profiles
UNION ALL
SELECT 'posts',
       count(*),
       md5(coalesce(string_agg(id::text || ':' || author_id::text, ',' ORDER BY id), ''))
FROM public.posts
UNION ALL
SELECT 'follows',
       count(*),
       md5(coalesce(string_agg(follower_id::text || ':' || following_id::text, ',' ORDER BY follower_id, following_id), ''))
FROM public.follows
UNION ALL
SELECT 'connections',
       count(*),
       md5(coalesce(string_agg(id::text || ':' || user_low_id::text || ':' || user_high_id::text || ':' || requested_by::text || ':' || status::text, ',' ORDER BY id), ''))
FROM public.connections
UNION ALL
SELECT 'notifications',
       count(*),
       md5(coalesce(string_agg(id::text || ':' || recipient_id::text || ':' || coalesce(actor_id::text, '') || ':' || notification_type::text, ',' ORDER BY id), ''))
FROM public.notifications
UNION ALL
SELECT 'post_reactions',
       count(*),
       md5(coalesce(string_agg(post_id::text || ':' || user_id::text || ':' || reaction_type::text, ',' ORDER BY post_id, user_id), ''))
FROM public.post_reactions
UNION ALL
SELECT 'user_roles',
       count(*),
       md5(coalesce(string_agg(user_id::text || ':' || role::text, ',' ORDER BY user_id, role), ''))
FROM public.user_roles;

COMMIT;
