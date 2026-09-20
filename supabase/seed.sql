-- Local-only synthetic fixtures. No password, API secret or invitation token.
-- The isolated launcher verifies this repository's Colima database before seeding.
insert into storage.buckets (id, name, public, file_size_limit)
values ('knowledge-private', 'knowledge-private', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,
  email_change_token_new,email_change,email_change_token_current,reauthentication_token)
select fixture.id::uuid,'00000000-0000-0000-0000-000000000000'::uuid,'authenticated','authenticated',
  fixture.email,'',now(),'{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name',fixture.full_name),now(),now(),'','','','','',''
from (values
  ('10000000-0000-4000-8000-000000000001','owner@threadsignal.test','Alex Morgan'),
  ('10000000-0000-4000-8000-000000000002','admin@threadsignal.test','Sam Rivera'),
  ('10000000-0000-4000-8000-000000000003','member@threadsignal.test','Jordan Lee'),
  ('10000000-0000-4000-8000-000000000004','viewer@threadsignal.test','Taylor Chen'),
  ('10000000-0000-4000-8000-000000000005','outsider@threadsignal.test','Casey Ellis')
) as fixture(id,email,full_name)
on conflict (id) do nothing;

insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at)
select id,id,id::text,jsonb_build_object('sub',id::text,'email',email,'email_verified',true,'phone_verified',false),
  'email',now(),now() from auth.users
where id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005')
on conflict (provider_id,provider) do nothing;

insert into public.organizations(id,name,slug,billing_email,timezone,default_currency)
values
 ('20000000-0000-4000-8000-000000000001','ThreadSignal Studio','threadsignal-studio','owner@threadsignal.test','UTC','USD'),
 ('20000000-0000-4000-8000-000000000002','Northstar Workspace','northstar-workspace','outsider@threadsignal.test','UTC','USD')
on conflict (id) do nothing;

insert into public.organization_members(organization_id,user_id,role)
values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','admin'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','member'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','viewer'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000005','owner')
on conflict (organization_id,user_id) do nothing;

insert into public.subscriptions(organization_id,provider,plan_key,status,current_period_start,current_period_end)
values
 ('20000000-0000-4000-8000-000000000001','mock','growth','active',now(),now() + interval '30 days'),
 ('20000000-0000-4000-8000-000000000002','mock','trial','trialing',now(),now() + interval '7 days')
on conflict (organization_id) do nothing;


-- Phase 2 synthetic knowledge: use the same audited allocation RPCs as the app.
-- Never replace an existing brand or reset customer edits, quotas, or source state.
do $$
declare
  v_org uuid := '20000000-0000-4000-8000-000000000001';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_source uuid := '30000000-0000-4000-8000-000000000001';
  v_brand uuid;
  v_brand_limit integer;
  v_page_limit integer;
  v_profile jsonb := '{
    "name":"ClarityScale AI","website_url":"https://clarityscale.example",
    "description":"Image optimization and upscaling API for ecommerce teams and developers.",
    "value_proposition":"Optimize product images and integrate batch upscaling into your application.",
    "target_audience":"Ecommerce teams and API developers","use_cases":["Product photography","Batch image optimization"],
    "category":"Image processing API","pricing_url":"https://clarityscale.example/pricing",
    "docs_url":"https://clarityscale.example/docs","support_url":"https://clarityscale.example/support",
    "tone":"Technical","custom_tone":"","reply_length":"standard","real_role":"employee",
    "disclosure_text":"I work with the team behind ClarityScale AI.",
    "avoid_claims":["Perfect recovery from every source image"],"allowed_links":["https://clarityscale.example/docs"],
    "countries":["Worldwide"],"competitors":[
      {"name":"SharpPixel","domain":"https://sharppixel.example","aliases":[]},
      {"name":"ImageLift","domain":"https://imagelift.example","aliases":[]}],
    "keywords":["image optimization","image upscaling API","batch processing"],"exclusions":["no vendor responses"]
  }'::jsonb;
begin
  select c.brand_limit,case when c.key='growth' then 100 else 30 end into v_brand_limit,v_page_limit
    from public.subscriptions s join public.plan_catalog c on c.key=s.plan_key
    where s.organization_id=v_org and s.status in ('active','trialing') and s.current_period_end>now();
  if v_brand_limit is null then return; end if;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  select id into v_brand from public.brands where organization_id=v_org and website_url='https://clarityscale.example' order by created_at limit 1;
  if v_brand is null and (select count(*) from public.brands where organization_id=v_org and status='active') < v_brand_limit then
    v_brand := public.save_brand(v_org,null,v_profile);
  end if;
  if v_brand is not null and exists(select 1 from public.brands where id=v_brand and status='active')
    and (select count(*) from public.knowledge_sources where brand_id=v_brand and deleted_at is null)<100
    and (select coalesce(sum(cardinality(selected_pages)),0) from public.knowledge_sources where brand_id=v_brand and deleted_at is null)+6<=v_page_limit
    and not exists(select 1 from public.knowledge_sources where id=v_source)
    and not exists(select 1 from public.audit_logs where target_id=v_source and action='knowledge.delete_requested') then
    perform public.add_knowledge_source(v_brand,v_source,'{
      "name":"ClarityScale demo website","type":"website","text":"","filename":"","mime_type":"","storage_path":"",
      "pages":["https://clarityscale.example/","https://clarityscale.example/docs","https://clarityscale.example/pricing",
        "https://clarityscale.example/limits","https://clarityscale.example/security","https://clarityscale.example/support"]
    }'::jsonb);
  end if;
end $$;

-- Phase 6 initializes settings only for the explicitly synthetic workspace.
-- Clicks, conversions and revenue are created through the consented demo journey,
-- never inserted as dashboard numbers or attributed to a real customer.
insert into public.tracking_settings(organization_id)
  select id from public.organizations where id='20000000-0000-4000-8000-000000000001'
  on conflict(organization_id) do nothing;

-- Phase 7 initializes preferences only for the named synthetic workspace.
-- Reruns preserve each person's choices and never synthesize payments or deliveries.
insert into public.notification_preferences(organization_id,user_id)
  select organization_id,user_id from public.organization_members
  where organization_id='20000000-0000-4000-8000-000000000001'
  on conflict(organization_id,user_id) do nothing;

-- Phase 3: initialize only the named synthetic demo brand once. Audited RPCs
-- enforce real plan capacity; reruns never resume a community the owner paused.
do $$
declare
  v_org uuid := '20000000-0000-4000-8000-000000000001';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_brand uuid;
  v_name text;
begin
  select b.id into v_brand from public.brands b
    where b.organization_id=v_org and b.website_url='https://clarityscale.example' and b.status='active'
    order by b.created_at limit 1;
  if v_brand is null or exists(select 1 from public.audit_logs where organization_id=v_org and target_id=v_brand and action='demo.phase3_seeded') then return; end if;
  if not exists(select 1 from public.subscriptions where organization_id=v_org and status in ('active','trialing') and current_period_end>now()) then return; end if;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  foreach v_name in array array['SaaS','webdev','ecommerce','ArtificialIntelligence'] loop
    perform public.add_brand_subreddit(v_brand,v_name,'{}'::jsonb);
  end loop;
  perform private.audit(v_org,'demo.phase3_seeded','brand',v_brand);
end $$;

-- Phase 4: queue one genuine mock pipeline draft once the Phase 3 worker has
-- produced an eligible demo opportunity. Reruns preserve all human edits/reviews.
do $$
declare
  v_org uuid := '20000000-0000-4000-8000-000000000001';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_opportunity uuid;
  v_brand uuid;
begin
  select b.id into v_brand from public.brands b where b.organization_id=v_org
    and b.website_url='https://clarityscale.example' and b.status='active' order by created_at limit 1;
  if v_brand is null or exists(select 1 from public.audit_logs where organization_id=v_org
    and target_id=v_brand and action='demo.phase4_seeded') then return; end if;
  if not exists(select 1 from public.subscriptions where organization_id=v_org
    and status in ('active','trialing') and current_period_end>now()) then return; end if;
  select o.id into v_opportunity from public.opportunities o join public.reddit_posts p on p.id=o.reddit_post_id
    join public.brand_subreddits m on m.brand_id=o.brand_id and m.subreddit_id=p.subreddit_id
    where o.brand_id=v_brand and not o.is_blocked and o.status not in ('archived','dismissed')
      and not p.is_deleted and not p.is_locked and not p.is_archived and m.status='active'
      and p.last_synced_at>=now()-interval '48 hours' and p.created_at_provider>=now()-interval '30 days'
      and exists(select 1 from public.knowledge_sources s where s.brand_id=v_brand and s.status in ('ready','partial')
        and s.deleted_at is null and s.last_ingested_at>now()-interval '90 days')
    order by o.final_score desc,o.id limit 1;
  if v_opportunity is null then return; end if;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  if (public.get_draft_usage(v_org)->>'quantity')::int >= (public.get_draft_usage(v_org)->>'limit')::int then return; end if;
  perform public.request_draft(v_opportunity,'40000000-0000-4000-8000-000000000004','{}');
  perform private.audit(v_org,'demo.phase4_seeded','brand',v_brand);
end $$;
