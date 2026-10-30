alter table public.user_data
  add column if not exists version integer not null default 0
  check (version >= 0);

create or replace function public.write_user_data(
  p_data jsonb,
  p_expected_version integer
)
returns table (
  result_data jsonb,
  result_version integer,
  has_conflict boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  current_row public.user_data%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Account data must be a JSON object';
  end if;

  if octet_length(p_data::text) > 1048576 then
    raise exception 'Account data exceeds the 1 MB limit';
  end if;

  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'Expected version must be a non-negative integer';
  end if;

  insert into public.user_data (user_id, data, version)
  values (caller_id, '{}'::jsonb, 0)
  on conflict (user_id) do nothing;

  select *
    into current_row
    from public.user_data
   where user_id = caller_id
   for update;

  if current_row.version <> p_expected_version then
    return query
      select current_row.data, current_row.version, true;
    return;
  end if;

  update public.user_data
     set data = p_data,
         version = current_row.version + 1,
         updated_at = now()
   where user_id = caller_id
   returning * into current_row;

  return query
    select current_row.data, current_row.version, false;
end;
$$;

revoke all on function public.write_user_data(jsonb, integer) from public;
revoke all on function public.write_user_data(jsonb, integer) from anon;
grant execute on function public.write_user_data(jsonb, integer) to authenticated;

revoke insert, update on public.user_data from public, anon, authenticated;
grant select on public.user_data to authenticated;

drop policy if exists "Users can insert their own data" on public.user_data;
drop policy if exists "Users can update their own data" on public.user_data;
