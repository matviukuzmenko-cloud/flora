create table if not exists public.push_subscriptions (
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  last_sent_on date,
  updated_at timestamptz not null default now(),
  primary key (user_id, endpoint),
  constraint push_subscriptions_endpoint_length check (length(endpoint) between 1 and 2048),
  constraint push_subscriptions_key_lengths check (length(p256dh) between 40 and 200 and length(auth) between 16 and 100)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users manage their own push subscriptions" on public.push_subscriptions;
create policy "Users manage their own push subscriptions"
  on public.push_subscriptions for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flora-journal', 'flora-journal', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Users read their own garden photos" on storage.objects;
create policy "Users read their own garden photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'flora-journal'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users upload their own garden photos" on storage.objects;
create policy "Users upload their own garden photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'flora-journal'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users update their own garden photos" on storage.objects;
create policy "Users update their own garden photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'flora-journal'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'flora-journal'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users delete their own garden photos" on storage.objects;
create policy "Users delete their own garden photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'flora-journal'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
