-- Invitation access expires immediately in the existing authorization RPCs.
-- Retain terminal invitation history for 30 days before bounded physical cleanup.
create index organization_invitations_retention_idx
  on public.organization_invitations ((coalesce(greatest(accepted_at,revoked_at),expires_at)),id);

create function private.cleanup_expired_invitations(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare v_deleted integer;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'INVALID_MAINTENANCE_LIMIT';
  end if;
  -- Preserve history after the latest terminal action. Pending invitations use
  -- their expiration time; live and recently terminal invitations never qualify.
  -- Lock only this batch and skip rows currently being accepted/revoked/cleaned.
  with candidates as materialized (
    select id from public.organization_invitations
    where coalesce(greatest(accepted_at,revoked_at),expires_at)<now()-interval '30 days'
    order by coalesce(greatest(accepted_at,revoked_at),expires_at),id
    limit p_limit for update skip locked
  )
  delete from public.organization_invitations i using candidates c where i.id=c.id;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end $$;
revoke all on function private.cleanup_expired_invitations(integer) from public,anon,authenticated;
