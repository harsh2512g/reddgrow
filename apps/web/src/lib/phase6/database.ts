import 'server-only';
import { runtimeDatabaseOptions } from '../env/runtime';
import { getServerEnv } from '../env/server';
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
  const connection = runtimeDatabaseOptions(getServerEnv());
  client ??= postgres({
    ...connection,
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
