-- Cached reports are readable only through the plan-aware, tenant-authorized RPC.
revoke all on public.analytics_cache from authenticated;

-- Already accepted events remain idempotent after the attribution window closes.
-- Current credential, consent, origin, plan and link checks still precede replay.
create or replace function private.ingest_conversion(p_key_hash text,p_receipt_hash text,p_origin text,p_event jsonb,p_allow_fixture boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.tracking_clicks;l public.tracking_links;k public.conversion_api_keys;v_days integer;v_date timestamptz;v_source text;v_hash text;v_value numeric;v_id uuid;existing public.conversion_events;v_external text;v_idempotency uuid;v_metadata jsonb;
begin
  if p_event is null or jsonb_typeof(p_event)<>'object' or octet_length(p_event::text)>5000 or exists(select 1 from jsonb_object_keys(p_event) f where f not in ('clickId','event','externalId','idempotencyKey','value','currency','occurredAt','metadata','consent','brandId'))
    or p_event->>'clickId' is null or p_event->>'clickId' !~ '^[a-f0-9-]{36}$' or p_event->>'event' is null or p_event->>'event' not in ('signup','lead','trial_started','purchase','custom')
    or jsonb_typeof(p_event->'value') is distinct from 'number' or p_event->>'currency' is null or p_event->>'currency' not in ('USD','EUR','GBP','INR','CAD','AUD','NZD','SGD','HKD','CHF','CNY','SEK','NOK','DKK','PLN','BRL','MXN','ZAR','AED','SAR','JPY','KRW','CLP','VND','BHD','KWD','OMR','TND')
    or p_event->>'occurredAt' is null or jsonb_typeof(p_event->'occurredAt')<>'string' then raise exception 'INVALID_CONVERSION'; end if;
  v_external:=p_event->>'externalId';
  if v_external is not null and v_external !~ '^[A-Za-z0-9_.:-]{1,128}$' then raise exception 'INVALID_CONVERSION'; end if;
  if p_event->>'idempotencyKey' is not null and p_event->>'idempotencyKey' !~ '^[a-f0-9-]{36}$' then raise exception 'INVALID_CONVERSION'; end if;
  v_idempotency:=(p_event->>'idempotencyKey')::uuid;
  if v_external is null and v_idempotency is null then raise exception 'CONVERSION_DEDUPE_REQUIRED'; end if;
  v_value:=(p_event->>'value')::numeric;
  if v_value<0 or v_value>1000000000 or v_value<>round(v_value,case when p_event->>'currency' in ('JPY','KRW','CLP','VND') then 0 when p_event->>'currency' in ('BHD','KWD','OMR','TND') then 3 else 2 end) then raise exception 'INVALID_CONVERSION_VALUE'; end if;
  v_metadata:=coalesce(p_event->'metadata','{}'::jsonb);
  if jsonb_typeof(v_metadata)<>'object' or exists(select 1 from jsonb_each(v_metadata) e where e.key not in ('plan','customName') or jsonb_typeof(e.value)<>'string' or e.value#>>'{}' !~ '^[A-Za-z0-9 _.-]{1,64}$') then raise exception 'INVALID_CONVERSION_METADATA'; end if;
  if p_event->>'event'='custom' and v_metadata->>'customName' is null then raise exception 'INVALID_CONVERSION_METADATA'; end if;
  begin v_date:=(p_event->>'occurredAt')::timestamptz; exception when others then raise exception 'INVALID_CONVERSION_TIME'; end;
  if not isfinite(v_date) or v_date>now()+interval '5 minutes' then raise exception 'INVALID_CONVERSION_TIME'; end if;
  select * into c from public.tracking_clicks where id=(p_event->>'clickId')::uuid;
  if not found then raise exception 'CONVERSION_CLICK_INVALID'; end if;
  if p_event->>'brandId' is not null and p_event->>'brandId'<>c.brand_id::text then raise exception 'CONVERSION_CLICK_INVALID'; end if;
  perform 1 from public.organizations where id=c.organization_id for update;
  select * into c from public.tracking_clicks where id=c.id;
  if not found then raise exception 'CONVERSION_CLICK_INVALID'; end if;
  select * into strict l from public.tracking_links where id=c.tracking_link_id;
  if l.status<>'active' or not private.tracking_destination_allowed(l.brand_id,l.destination_url) then raise exception 'TRACKING_LINK_UNAVAILABLE'; end if;
  perform private.require_tracking_feature(c.organization_id,'conversionTracking');
  if p_key_hash is not null then
    if p_receipt_hash is not null or p_origin is not null or p_key_hash !~ '^[a-f0-9]{64}$' then raise exception 'CONVERSION_KEY_INVALID'; end if;
    select * into k from public.conversion_api_keys where key_hash=p_key_hash and organization_id=c.organization_id and brand_id=c.brand_id and revoked_at is null for update;
    if not found then raise exception 'CONVERSION_KEY_INVALID'; end if;
    perform private.require_tracking_feature(c.organization_id,'conversionApi');
    v_source:='server';
  else
    if p_event->'consent' is distinct from 'true'::jsonb then raise exception 'CONVERSION_CONSENT_REQUIRED'; end if;
    if p_receipt_hash is null or p_receipt_hash is distinct from c.receipt_hash then raise exception 'CONVERSION_RECEIPT_INVALID'; end if;
    if p_origin is null or not ((p_origin='https://'||private.tracking_url_host(l.destination_url)) or (p_allow_fixture is true and p_origin='http://127.0.0.1:3000' and private.tracking_url_host(l.destination_url)='clarityscale.example')) then raise exception 'CONVERSION_ORIGIN_DENIED'; end if;
    v_source:='browser';
  end if;
  -- Credential/source are not part of logical identity: retries may safely cross transport.
  v_hash:=encode(extensions.digest(jsonb_build_object('clickId',c.id,'event',p_event->>'event','externalId',v_external,'value',v_value,'currency',p_event->>'currency','occurredAt',v_date,'metadata',v_metadata)::text,'sha256'),'hex');
  select * into existing from public.conversion_events where brand_id=c.brand_id and ((external_id=v_external and event_type=p_event->>'event') or (idempotency_key=v_idempotency)) order by created_at,id limit 1;
  if found then
    if existing.payload_hash<>v_hash then raise exception 'CONVERSION_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('id',existing.id,'duplicate',true);
  end if;
  select coalesce((select attribution_days from public.tracking_settings where organization_id=c.organization_id),30) into v_days;
  if v_date<c.occurred_at or v_date>c.occurred_at+make_interval(days=>v_days) or now()>c.occurred_at+make_interval(days=>v_days)+interval '5 minutes' then raise exception 'CONVERSION_OUTSIDE_WINDOW'; end if;
  insert into public.conversion_events(organization_id,brand_id,tracking_click_id,tracking_link_id,event_type,external_id,idempotency_key,value,currency,occurred_at,metadata,source,payload_hash)
    values(c.organization_id,c.brand_id,c.id,l.id,p_event->>'event',v_external,v_idempotency,v_value,p_event->>'currency',v_date,v_metadata,v_source,v_hash) returning id into v_id;
  if k.id is not null then update public.conversion_api_keys set last_used_at=now() where id=k.id; end if;
  return jsonb_build_object('id',v_id,'duplicate',false);
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'INVALID_CONVERSION';
end $$;
