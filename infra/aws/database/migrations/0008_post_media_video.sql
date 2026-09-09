alter table public.post_media
  drop constraint post_media_mime_check;
-- statement-breakpoint
alter table public.post_media
  add constraint post_media_mime_check check (
    mime_type in (
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/webm'
    )
  );
