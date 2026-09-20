/** Fixed private RPCs; requests cannot choose SQL or a database. */
export const attributionStatements = {
  redirect: 'select private.tracking_redirect($1,$2::uuid,$3,$4,$5::boolean) as value',
  // The caller supplies serialized JSON. Bind it as text so postgres.js cannot serialize it twice.
  conversion: 'select private.ingest_conversion($1,$2,$3,$4::text::jsonb,$5::boolean) as value',
  origin: 'select private.tracking_browser_origin_allowed($1::uuid,$2,$3::boolean) as value',
} as const;
