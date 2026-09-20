import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-hosted/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '.threadsignal/**',
      '.pnpm-store/**',
      '**/next-env.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/public/threadsignal.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
);
