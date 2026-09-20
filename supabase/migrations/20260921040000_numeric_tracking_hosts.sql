-- WHATWG URLs also recognize a hexadecimal final label as an IPv4 spelling.
-- Reject it before a direct authenticated RPC can create or count such a link.
create or replace function private.tracking_url_host(p_url text) returns text
language plpgsql immutable set search_path='' as $$
declare v_host text;v_label text;v_tld text;
begin
  if p_url is null or char_length(p_url)>2048 or p_url !~ '^https://[^/?#]+([/?][^#[:space:]\\]*)?$'
    or p_url ~ '[[:cntrl:][:space:]]' then return null; end if;
  v_host:=substring(p_url from '^https://([^/?#]+)');
  if v_host is null or char_length(v_host)>253 or v_host !~ '^[a-z0-9.-]+$' or position('.' in v_host)=0 then return null; end if;
  foreach v_label in array string_to_array(v_host,'.') loop
    if char_length(v_label) not between 1 and 63 or v_label !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' then return null; end if;
    v_tld:=v_label;
  end loop;
  if v_tld ~ '^([0-9]+|0x[0-9a-f]+)$' or v_tld in ('localhost','local','internal','lan','home','onion','invalid') then return null; end if;
  return v_host;
end $$;
