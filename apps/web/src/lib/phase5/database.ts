import 'server-only';
import postgres from 'postgres';
import { localDraftsEnabled } from '../phase4/server';
import { ExtensionError } from './errors';
const queries = {
  exchange: 'select private.exchange_extension_code($1,$2,$3) as value',
  current: 'select private.extension_current($1,$2,$3,$4,$5::uuid) as value',
  save: 'select private.extension_save_draft($1,$2,$3::uuid,$4::integer,$5) as value',
  prepare: 'select private.extension_prepare_handoff($1,$2,$3::uuid,$4::integer,$5,$6) as value',
  inserted: 'select private.extension_mark_inserted($1,$2,$3::uuid,$4::integer,$5,$6) as value',
  published:
    'select private.extension_mark_published($1,$2,$3::uuid,$4::integer,$5,$6,$7) as value',
  disconnect: 'select private.disconnect_extension($1,$2) as value',
} as const;
/** Fixed statements only. Every transaction drops to the dedicated API role first. */
export async function extensionDatabase(
  operation: keyof typeof queries,
  args: (string | number | null)[],
): Promise<unknown> {
  if (!localDraftsEnabled()) throw new ExtensionError('LOCAL_ONLY', 503);
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new ExtensionError('UNAVAILABLE', 503);
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '54322' ||
    url.pathname !== '/postgres' ||
    url.search ||
    url.hash
  )
    throw new ExtensionError('LOCAL_ONLY', 503);
  const sql = postgres(raw, {
    max: 1,
    connect_timeout: 3,
    idle_timeout: 1,
    onnotice: () => undefined,
    connection: { application_name: 'threadsignal-extension-api', statement_timeout: 10000 },
  });
  try {
    return await sql.begin(async (tx) => {
      await tx`set local role threadsignal_extension_api`;
      const rows = await tx.unsafe(queries[operation], args);
      return rows[0]?.value as unknown;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
