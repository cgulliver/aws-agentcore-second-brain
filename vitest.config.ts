import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'test/**/*.test.ts',
      'test/**/*.property.test.ts',
    ],
    exclude: [
      'node_modules',
      'dist',
      'cdk.out',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'lib/**/*.ts'],
      exclude: [
        'node_modules',
        'test',
        '**/*.d.ts',
        'bin/**',
      ],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    // Property-based testing configuration
    // fast-check will use 100 iterations by default
  },
});
