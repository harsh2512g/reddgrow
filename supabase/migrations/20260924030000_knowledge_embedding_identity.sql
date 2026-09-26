-- Existing embeddings were produced by the deterministic 512-dimensional fixture provider.
alter table public.knowledge_documents add column embedding_identity text not null default 'mock:deterministic:512:v1'
  check(embedding_identity ~ '^(mock:deterministic|openai:[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}):512:v1$');
alter table public.knowledge_chunks add column embedding_identity text not null default 'mock:deterministic:512:v1'
  check(embedding_identity ~ '^(mock:deterministic|openai:[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}):512:v1$');
create index knowledge_chunks_embedding_identity_idx on public.knowledge_chunks(brand_id,embedding_identity);

create function public.search_knowledge(p_brand_id uuid,p_embedding extensions.vector(512),p_query text,p_embedding_identity text)
returns table(id uuid,source_id uuid,document_id uuid,title text,source_url text,page_number integer,content text,score double precision)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_embedding is null or extensions.vector_dims(p_embedding)<>512 or p_query is null or char_length(p_query) not between 1 and 500
    or p_embedding_identity is null or p_embedding_identity !~ '^(mock:deterministic|openai:[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}):512:v1$'
    then raise exception 'INVALID_SEARCH'; end if;
  return query select c.id,c.source_id,c.document_id,d.title,d.canonical_url,d.page_number,c.content,
    (0.8*(1-(c.embedding operator(extensions.<=>) p_embedding))+0.2*ts_rank_cd(to_tsvector('english',c.content),plainto_tsquery('english',p_query)))::double precision
    from public.knowledge_chunks c join public.knowledge_documents d on d.id=c.document_id
    join public.knowledge_sources s on s.id=c.source_id join public.brands b on b.id=c.brand_id
    where c.brand_id=p_brand_id and b.status='active' and s.deleted_at is null and s.status in ('ready','partial') and d.is_included
      and c.embedding_identity=p_embedding_identity and d.embedding_identity=p_embedding_identity
    order by (0.8*(1-(c.embedding operator(extensions.<=>) p_embedding))+0.2*ts_rank_cd(to_tsvector('english',c.content),plainto_tsquery('english',p_query))) desc,c.id
    limit 20;
end $$;

-- Preserve old clients while refusing to silently compare mock vectors to a different model.
create or replace function public.search_knowledge(p_brand_id uuid,p_embedding extensions.vector(512),p_query text)
returns table(id uuid,source_id uuid,document_id uuid,title text,source_url text,page_number integer,content text,score double precision)
language sql stable security invoker set search_path='' as $$
  select * from public.search_knowledge(p_brand_id,p_embedding,p_query,'mock:deterministic:512:v1');
$$;
revoke all on function public.search_knowledge(uuid,extensions.vector,text,text) from public,anon;
grant execute on function public.search_knowledge(uuid,extensions.vector,text,text) to authenticated;
