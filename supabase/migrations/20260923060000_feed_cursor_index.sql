-- Match the default feed's score-descending, UUID-descending keyset cursor.
-- Keep the original index until production measurements justify its removal.
create index opportunities_score_cursor_idx on public.opportunities(organization_id,brand_id,final_score desc,id desc);
