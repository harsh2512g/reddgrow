import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  // Server functions import compiled packages from the repository workspace.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // Separate generated output allows the local and personal hosted profiles to run together.
  distDir:
    process.env.THREADSIGNAL_SUPABASE_MODE === 'personal-development' ? '.next-hosted' : '.next',
  typescript: {
    tsconfigPath:
      process.env.THREADSIGNAL_SUPABASE_MODE === 'personal-development'
        ? 'tsconfig.hosted.json'
        : 'tsconfig.json',
  },
  // Authentication codes, invitation URLs and form arguments must not enter dev logs.
  logging: false,
  poweredByHeader: false,
  transpilePackages: ['@threadsignal/config', '@threadsignal/shared', '@threadsignal/ui'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
