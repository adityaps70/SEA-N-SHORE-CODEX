-- Round P3 (Part D, option a): MediaConvert renditions of course videos.
--
-- One row per uploaded course trailer or lesson video, keyed by its storage path, so a draft revision that carries the
-- same file over shares the same rendition. The outbox worker queues a job for a newly saved video, polls it, and
-- marks the row ready once the 720p MP4 and the HLS 360p/720p ladder are under m/v/<folder>/ (served by the signed
-- media CDN). Players use a ready rendition and fall back to the uploaded file otherwise. Only statuses, the job id,
-- the output folder, the source duration (for the monthly minute cap) and an error code are stored.
--
-- Additive only: one new table and one partial index. No existing row is read or written.
-- Reversible: drop table public.learning_media_renditions; (the app built before this release never reads it, and
-- players fall back to the uploaded file when the table or a row is missing).

create table if not exists public.learning_media_renditions (
  source_path text primary key,
  kind text not null,
  status text not null default 'queued',
  job_id text,
  output_folder text,
  duration_seconds integer,
  error_code text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  constraint learning_media_renditions_source_check check (char_length(source_path) between 1 and 1024),
  constraint learning_media_renditions_kind_check check (kind in ('course_trailer', 'lesson_video')),
  constraint learning_media_renditions_status_check check (status in ('queued', 'processing', 'ready', 'error', 'unreferenced')),
  constraint learning_media_renditions_job_check check (job_id is null or char_length(job_id) <= 128),
  constraint learning_media_renditions_folder_check check (output_folder is null or output_folder ~ '^m/v/[A-Za-z0-9_-]{32}$'),
  constraint learning_media_renditions_duration_check check (duration_seconds is null or duration_seconds between 0 and 86400),
  constraint learning_media_renditions_error_check check (error_code is null or char_length(error_code) <= 120),
  constraint learning_media_renditions_attempts_check check (attempts between 0 and 10)
);
-- statement-breakpoint

create index if not exists learning_media_renditions_pending_idx
  on public.learning_media_renditions (status, updated_at)
  where status in ('queued', 'processing');
