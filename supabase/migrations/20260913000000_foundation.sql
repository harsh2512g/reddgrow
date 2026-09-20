-- Phase 0 infrastructure only. Customer tables and their RLS arrive in Phase 1.
create extension if not exists vector with schema extensions;

-- Default deny future anonymous table/function access. Each feature migration
-- must explicitly grant permissions and enable its tenant policies.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;

insert into storage.buckets (id, name, public, file_size_limit)
values ('knowledge-private', 'knowledge-private', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
