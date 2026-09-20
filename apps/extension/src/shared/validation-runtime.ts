import { z } from 'zod';

// Imported before modules construct schemas: MV3 forbids optional runtime compilation.
z.config({ jitless: true });
