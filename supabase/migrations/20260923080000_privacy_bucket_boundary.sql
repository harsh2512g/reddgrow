-- Refuse a pre-existing or manually changed export bucket with broader visibility.
-- No migration silently changes an unrelated Storage bucket's configuration.
do $$ begin
  if not exists(select 1 from storage.buckets where id='privacy-exports' and name='privacy-exports'
    and public=false and file_size_limit=67108864 and allowed_mime_types=array['application/gzip'])
    then raise exception 'PRIVACY_BUCKET_CONFIGURATION_CONFLICT'; end if;
end $$;
