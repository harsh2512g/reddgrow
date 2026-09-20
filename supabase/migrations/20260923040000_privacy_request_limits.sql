-- Existing legacy requests may be explicitly confirmed, but cannot bypass quotas.
create or replace function public.begin_organization_export(p_organization_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_confirmed timestamptz;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner']::public.organization_role[]);
  select id,confirmed_at into v_id,v_confirmed from public.organization_data_requests where organization_id=p_organization_id
    and kind='export' and status in ('requested','processing');
  if v_confirmed is null and (select count(*) from public.organization_data_requests where organization_id=p_organization_id
    and kind='export' and confirmed_at>now()-interval '24 hours')>=3 then raise exception 'EXPORT_RATE_LIMIT'; end if;
  if v_id is null then
    insert into public.organization_data_requests(organization_id,requested_by,kind,confirmed_at)
      values(p_organization_id,auth.uid(),'export',now()) returning id into v_id;
  else
    update public.organization_data_requests set confirmed_at=coalesce(confirmed_at,now()),requested_by=auth.uid() where id=v_id;
  end if;
  insert into public.privacy_jobs(id,organization_id,kind) values(v_id,p_organization_id,'export') on conflict(id) do nothing;
  perform private.audit(p_organization_id,'organization.export_confirmed','data_request',v_id);
  return v_id;
end $$;

create or replace function public.list_organization_data_requests(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_role(p_organization_id,array['owner']::public.organization_role[]);
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,
    'status',case when r.status='completed' and r.kind='export' and r.expires_at<=now() then 'expired' else r.status end,
    'created_at',r.created_at,'confirmed_at',r.confirmed_at,'completed_at',r.completed_at,
    'expires_at',r.expires_at,'error_code',r.error_code,
    'download_available',coalesce(r.kind='export' and r.status='completed' and r.expires_at>now() and r.artifact_path is not null,false))
    order by r.created_at desc,r.id) from (select * from public.organization_data_requests
    where organization_id=p_organization_id order by created_at desc,id limit 50) r),'[]'::jsonb);
end $$;
