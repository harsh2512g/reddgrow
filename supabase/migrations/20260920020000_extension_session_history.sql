-- Keep every visible active connection revocable while bounding retained history.
-- Expiry and revocation continue to be checked independently on every token action.
create index extension_sessions_history_idx on public.extension_sessions(organization_id,created_at desc,id);

create or replace function public.list_extension_sessions(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.organization_role;
begin
  r:=private.require_role(p_organization_id,array['owner','admin','member']::public.organization_role[]);
  return (
    with visible as not materialized (
      select s.* from public.extension_sessions s
      where s.organization_id=p_organization_id and (r in ('owner','admin') or s.user_id=auth.uid())
    ), selected as (
      select * from visible where revoked_at is null and expires_at>now()
      union all
      (select * from visible where revoked_at is not null or expires_at<=now()
        order by created_at desc,id limit 50)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'organization_id',s.organization_id,'user_id',s.user_id,'name',s.name,
      'last_used_at',s.last_used_at,'expires_at',s.expires_at,'revoked_at',s.revoked_at,'created_at',s.created_at
    ) order by s.created_at desc,s.id),'[]'::jsonb) from selected s
  );
end $$;
