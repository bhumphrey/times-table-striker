import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the production build runs from any static host path.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
