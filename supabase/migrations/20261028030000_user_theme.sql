-- Theme preference per account so phone and desktop match (device copy lives in localStorage).
alter table public.user_settings
  add column if not exists theme text not null default 'dark' check (theme in ('dark', 'light', 'system'));
