begin;

-- Business data is accessed through the trusted server-side DATABASE_URL.
-- Keep the exposed public schema deny-by-default for browser Data API roles.
do $$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table %I.%I enable row level security',
      target.schema_name,
      target.table_name
    );
  end loop;
end
$$;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

-- Leave Supabase-managed extension functions alone and lock down app-owned RPCs.
do $$
declare
  target record;
begin
  for target in
    select p.oid::regprocedure as function_signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_userbyid(p.proowner) = 'postgres'
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      target.function_signature
    );
  end loop;
end
$$;

-- Vault credentials are only read and written by the server-side service client.
grant usage on schema public to service_role;
grant execute on function public.store_marketplace_credential(text, text, text) to service_role;
grant execute on function public.read_marketplace_credential(text) to service_role;
grant execute on function public.delete_marketplace_credential(text) to service_role;
grant execute on function public.update_marketplace_credential(text, text) to service_role;

-- Prevent future Drizzle/Supabase migrations from exposing new objects by default.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Abort the whole migration if any existing public object remains directly exposed.
do $$
declare
  unsafe_count integer;
begin
  select count(*)
  into unsafe_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity;

  if unsafe_count > 0 then
    raise exception '% public tables still have RLS disabled', unsafe_count;
  end if;

  select count(*)
  into unsafe_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (
      has_table_privilege('anon', c.oid, 'SELECT')
      or has_table_privilege('anon', c.oid, 'INSERT')
      or has_table_privilege('anon', c.oid, 'UPDATE')
      or has_table_privilege('anon', c.oid, 'DELETE')
      or has_table_privilege('authenticated', c.oid, 'SELECT')
      or has_table_privilege('authenticated', c.oid, 'INSERT')
      or has_table_privilege('authenticated', c.oid, 'UPDATE')
      or has_table_privilege('authenticated', c.oid, 'DELETE')
    );

  if unsafe_count > 0 then
    raise exception '% public relations are still granted to Data API roles', unsafe_count;
  end if;

  select count(*)
  into unsafe_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and pg_get_userbyid(p.proowner) = 'postgres'
    and (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );

  if unsafe_count > 0 then
    raise exception '% public functions are still executable by Data API roles', unsafe_count;
  end if;
end
$$;

commit;
