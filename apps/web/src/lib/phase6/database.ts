import 'server-only';
import postgres from 'postgres';
import { attributionEnabled } from './server';
import { AttributionError } from './errors';
import { attributionStatements } from './statements';
let client: ReturnType<typeof postgres> | undefined;
/** Fixed statements and a narrow role; no public request can choose SQL or a database. */
export async function attributionDatabase(
  operation: keyof typeof attributionStatements,
  args: (string | number | boolean | null)[],
): Promise<unknown> {
  if (!attributionEnabled()) throw new AttributionError('LOCAL_ONLY', 503);
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new AttributionError('UNAVAILABLE', 503);
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '54322' ||
    url.pathname !== '/postgres' ||
    url.search ||
    url.hash
  )
    throw new AttributionError('LOCAL_ONLY', 503);
  client ??= postgres(raw, {
    max: 4,
    connect_timeout: 2,
    idle_timeout: 10,
    max_lifetime: 300,
    onnotice: () => undefined,
    connection: { application_name: 'threadsignal-attribution', statement_timeout: 3000 },
  });
  return client.begin(async (tx) => {
    await tx`set local role threadsignal_tracking_api`;
    const rows = await tx.unsafe(attributionStatements[operation], args);
    return rows[0]?.value as unknown;
  });
}
