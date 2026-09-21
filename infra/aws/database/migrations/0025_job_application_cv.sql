-- Optional candidate CV attachment for Easy Apply applications.
-- Files remain private in the AWS media bucket; only metadata/storage references live in Aurora.

alter table public.job_applications
  add column if not exists cv_storage_path text,
  add column if not exists cv_file_name text,
  add column if not exists cv_mime_type text,
  add column if not exists cv_size_bytes integer;
-- statement-breakpoint

alter table public.job_applications
  drop constraint if exists job_applications_cv_metadata_check;
-- statement-breakpoint

alter table public.job_applications
  add constraint job_applications_cv_metadata_check check (
    (
      cv_storage_path is null
      and cv_file_name is null
      and cv_mime_type is null
      and cv_size_bytes is null
    )
    or (
      cv_storage_path is not null
      and cv_file_name is not null
      and cv_mime_type = 'application/pdf'
      and cv_size_bytes between 1 and 10485760
      and char_length(cv_storage_path) between 1 and 1024
      and char_length(cv_file_name) between 1 and 255
    )
  );
