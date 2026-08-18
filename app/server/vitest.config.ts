import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The setup file points the database at a throwaway file before any module
    // reads the environment, so integration tests never touch the dev data.
    setupFiles: ['./src/test/setup.ts'],
    // Suites share one SQLite file, so they must not run concurrently.
    fileParallelism: false,
  },
});
