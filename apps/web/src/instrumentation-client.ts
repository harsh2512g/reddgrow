import { z } from 'zod';

// Zod's capability probe attempts new Function even when its fallback works.
// Configure the interpreter synchronously before hydration to keep strict CSP quiet.
z.config({ jitless: true });
