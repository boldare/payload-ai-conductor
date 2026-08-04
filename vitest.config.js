import path from 'path'
import { loadEnv } from 'payload/node'
import { fileURLToPath } from 'url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default defineConfig(() => {
  loadEnv(path.resolve(dirname, './dev'))

  return {
    plugins: [
      tsconfigPaths({
        ignoreConfigErrors: true,
      }),
    ],
    test: {
      environment: 'node',
      exclude: ['**/node_modules/**', '**/e2e.spec.ts'],
      // dev/*.int.spec.ts files share one sqlite file (dev/test.db); running them
      // in parallel causes SQLITE_BUSY lock contention across worker processes.
      fileParallelism: false,
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  }
})
