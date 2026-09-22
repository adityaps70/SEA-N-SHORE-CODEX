alter table public.post_media
  add column if not exists position smallint not null default 0;
-- statement-breakpoint
alter table public.post_media
  add column if not exists file_name text;
-- statement-breakpoint
alter table public.post_media
  add column if not exists page_count smallint;
-- statement-breakpoint
alter table public.post_media
  drop constraint if exists post_media_post_id_key;
-- statement-breakpoint
alter table public.post_media
  drop constraint if exists post_media_mime_check;
-- statement-breakpoint
alter table public.post_media
  add constraint post_media_mime_check check (
    mime_type in (
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/webm',
      'application/pdf'
    )
  );
-- statement-breakpoint
alter table public.post_media
  add constraint post_media_rich_metadata_check check (
    position between 0 and 9
    and (file_name is null or char_length(file_name) between 1 and 255)
    and (
      (mime_type = 'application/pdf' and page_count between 1 and 50)
      or (mime_type <> 'application/pdf' and page_count is null)
    )
  );
-- statement-breakpoint
alter table public.post_media
  add constraint post_media_post_position_key unique (post_id, position);
