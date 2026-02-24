# Supabase timed comments (vodcasts)

The client expects a table named `timed_comments` with (at least) the following columns:

- `id` (uuid, primary key, default `gen_random_uuid()`)
- `content_id` (text, indexed)
- `t_seconds` (int)
- `name` (text, nullable)
- `body` (text)
- `user_id` (uuid) — Supabase auth user id
- `created_at` (timestamptz, default `now()`)

Suggested SQL:

```sql
create table if not exists public.timed_comments (
  id uuid primary key default gen_random_uuid(),
  content_id text not null,
  t_seconds int not null,
  name text,
  body text not null,
  user_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists timed_comments_content_time_idx
  on public.timed_comments (content_id, t_seconds, created_at);
```

## Auth / spam

The prototype flow uses:

- Supabase **Anonymous sign-in** (enable in Auth providers)
- Optional **hCaptcha** enforced via Supabase’s captcha support

Build-time env vars:

- `VOD_SUPABASE_URL`
- `VOD_SUPABASE_ANON_KEY`
- `VOD_HCAPTCHA_SITEKEY` (optional)

If Supabase is not configured, the UI shows “comments disabled”.

